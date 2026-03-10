import os
import hashlib
import secrets
from datetime import datetime, timezone
from functools import wraps

from flask import (
    Flask, render_template, request, redirect, url_for,
    send_file, flash, session, jsonify
)
from flask_sqlalchemy import SQLAlchemy
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash

# ── APP ──────────────────────────────────────────────────────────────────────

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", secrets.token_hex(32))

database_url = os.environ.get("DATABASE_URL", "sqlite:///local.db")
if database_url.startswith("postgres://"):
    database_url = database_url.replace("postgres://", "postgresql://", 1)

app.config["SQLALCHEMY_DATABASE_URI"] = database_url
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

db = SQLAlchemy(app)

# ── MODELS ───────────────────────────────────────────────────────────────────

class AdminUser(db.Model):
    __tablename__ = "admin_users"
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)

    def set_password(self, pw):
        self.password_hash = generate_password_hash(pw)

    def check_password(self, pw):
        return check_password_hash(self.password_hash, pw)


class Release(db.Model):
    __tablename__ = "releases"
    id = db.Column(db.Integer, primary_key=True)
    version = db.Column(db.String(50), nullable=False)
    filename = db.Column(db.String(255), nullable=False)
    original_name = db.Column(db.String(255), nullable=False)
    file_size = db.Column(db.BigInteger, default=0)
    file_hash = db.Column(db.String(64), nullable=True)
    changelog = db.Column(db.Text, default="")
    downloads = db.Column(db.Integer, default=0)
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    def size_display(self):
        if self.file_size < 1024:
            return f"{self.file_size} B"
        elif self.file_size < 1024 * 1024:
            return f"{self.file_size / 1024:.1f} KB"
        return f"{self.file_size / (1024 * 1024):.1f} MB"


class DownloadLog(db.Model):
    __tablename__ = "download_logs"
    id = db.Column(db.Integer, primary_key=True)
    release_id = db.Column(db.Integer, db.ForeignKey("releases.id"))
    ip_address = db.Column(db.String(45))
    user_agent = db.Column(db.String(512))
    downloaded_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))


# ── AUTH ─────────────────────────────────────────────────────────────────────

def admin_required(f):
    @wraps(f)
    def decorated(*a, **kw):
        if not session.get("admin_logged_in"):
            return redirect(url_for("admin_login"))
        return f(*a, **kw)
    return decorated


# ── INIT DB ──────────────────────────────────────────────────────────────────

with app.app_context():
    db.create_all()
    if not AdminUser.query.first():
        admin = AdminUser(username=os.environ.get("ADMIN_USER", "admin"))
        admin.set_password(os.environ.get("ADMIN_PASS", "changeme123"))
        db.session.add(admin)
        db.session.commit()


# ── PUBLIC ───────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    release = Release.query.filter_by(is_active=True).order_by(Release.created_at.desc()).first()
    total = db.session.query(db.func.sum(Release.downloads)).scalar() or 0
    return render_template("index.html", release=release, total_downloads=total)


@app.route("/download")
def download():
    release = Release.query.filter_by(is_active=True).order_by(Release.created_at.desc()).first()
    if not release:
        flash("No release available yet.", "error")
        return redirect(url_for("index"))

    filepath = os.path.join(UPLOAD_DIR, release.filename)
    if not os.path.exists(filepath):
        flash("File not found.", "error")
        return redirect(url_for("index"))

    release.downloads += 1
    db.session.add(DownloadLog(
        release_id=release.id,
        ip_address=request.remote_addr,
        user_agent=request.headers.get("User-Agent", "")[:512]
    ))
    db.session.commit()
    return send_file(filepath, as_attachment=True, download_name=release.original_name)


@app.route("/api/latest")
def api_latest():
    r = Release.query.filter_by(is_active=True).order_by(Release.created_at.desc()).first()
    if not r:
        return jsonify({"error": "No release"}), 404
    return jsonify({
        "version": r.version, "filename": r.original_name,
        "size": r.size_display(), "downloads": r.downloads,
        "changelog": r.changelog,
        "download_url": url_for("download", _external=True),
        "released_at": r.created_at.isoformat()
    })


# ── ADMIN ────────────────────────────────────────────────────────────────────

@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    if request.method == "POST":
        u = AdminUser.query.filter_by(username=request.form.get("username", "")).first()
        if u and u.check_password(request.form.get("password", "")):
            session["admin_logged_in"] = True
            session["admin_user"] = u.username
            return redirect(url_for("admin_dashboard"))
        flash("Invalid credentials.", "error")
    return render_template("login.html")


@app.route("/admin/logout")
def admin_logout():
    session.clear()
    return redirect(url_for("index"))


@app.route("/admin")
@admin_required
def admin_dashboard():
    releases = Release.query.order_by(Release.created_at.desc()).all()
    total = db.session.query(db.func.sum(Release.downloads)).scalar() or 0
    logs = DownloadLog.query.order_by(DownloadLog.downloaded_at.desc()).limit(30).all()
    return render_template("admin.html", releases=releases, total_downloads=total, recent_logs=logs)


@app.route("/admin/upload", methods=["POST"])
@admin_required
def admin_upload():
    file = request.files.get("file")
    version = request.form.get("version", "").strip()
    changelog = request.form.get("changelog", "").strip()

    if not file or not file.filename:
        flash("No file selected.", "error")
        return redirect(url_for("admin_dashboard"))
    if not version:
        flash("Version required.", "error")
        return redirect(url_for("admin_dashboard"))

    original = secure_filename(file.filename)
    stored = f"{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}_{original}"
    filepath = os.path.join(UPLOAD_DIR, stored)
    file.save(filepath)

    sha = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha.update(chunk)

    Release.query.update({"is_active": False})
    db.session.add(Release(
        version=version, filename=stored, original_name=original,
        file_size=os.path.getsize(filepath), file_hash=sha.hexdigest(),
        changelog=changelog, is_active=True
    ))
    db.session.commit()
    flash(f"v{version} uploaded!", "success")
    return redirect(url_for("admin_dashboard"))


@app.route("/admin/activate/<int:rid>", methods=["POST"])
@admin_required
def admin_activate(rid):
    Release.query.update({"is_active": False})
    r = Release.query.get_or_404(rid)
    r.is_active = True
    db.session.commit()
    flash(f"v{r.version} is now active.", "success")
    return redirect(url_for("admin_dashboard"))


@app.route("/admin/delete/<int:rid>", methods=["POST"])
@admin_required
def admin_delete(rid):
    r = Release.query.get_or_404(rid)
    path = os.path.join(UPLOAD_DIR, r.filename)
    if os.path.exists(path):
        os.remove(path)
    DownloadLog.query.filter_by(release_id=r.id).delete()
    db.session.delete(r)
    db.session.commit()
    flash(f"v{r.version} deleted.", "success")
    return redirect(url_for("admin_dashboard"))


@app.route("/admin/password", methods=["POST"])
@admin_required
def admin_password():
    pw = request.form.get("new_password", "")
    if len(pw) < 6:
        flash("Min 6 characters.", "error")
        return redirect(url_for("admin_dashboard"))
    u = AdminUser.query.filter_by(username=session.get("admin_user")).first()
    if u:
        u.set_password(pw)
        db.session.commit()
        flash("Password changed.", "success")
    return redirect(url_for("admin_dashboard"))


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
