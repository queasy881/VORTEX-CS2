# VORTEX CS2 — Download Portal

Distribution portal for VORTEX CS2 releases.
Built with Flask + PostgreSQL. Deploys to Railway via GitHub.

---

## What's included

- **Landing page** (`/`) — Product info, feature highlights, download button
- **Download** (`/download`) — Serves the latest active release, tracks downloads
- **API** (`/api/latest`) — JSON endpoint for latest release info
- **Dev Portal** (`/admin`) — Upload new releases, activate/deactivate versions, view download stats, change password

---

## Deploy to Railway (step by step)

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/queasy881/VORTEX-CS2.git
git branch -M main
git push -u origin main
```

### 2. Create Railway project

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click **"New Project"** → **"Deploy from GitHub Repo"**
3. Select your `VORTEX-CS2` repo

### 3. Add PostgreSQL

1. In your Railway project, click **"+ New"** → **"Database"** → **"PostgreSQL"**
2. Railway automatically sets `DATABASE_URL` — no config needed

### 4. Set environment variables

In your Railway service, go to **Variables** tab and add:

| Variable | Value |
|----------|-------|
| `SECRET_KEY` | Any random string (e.g. `mysecretkey123xyz`) |
| `ADMIN_USER` | Your admin username (default: `admin`) |
| `ADMIN_PASS` | Your admin password (default: `changeme123`) |

### 5. Deploy

Railway auto-deploys on every push to `main`. Your site will be live at the Railway-provided URL.

To add a custom domain: **Settings** → **Networking** → **Custom Domain**

---

## Run locally

```bash
pip install -r requirements.txt
python app.py
```

Opens at `http://localhost:5000`. Uses SQLite locally (no Postgres needed).

Admin login: `admin` / `changeme123` (or whatever you set in env vars).

---

## Dev Portal usage

1. Go to `yoursite.com/admin/login`
2. Log in with your admin credentials
3. Upload a new VORTEX release file with a version number
4. It automatically becomes the active download
5. Users on the landing page see the download button with your version

To roll back: click **Activate** on any older release in the dashboard.

---

## File structure

```
├── app.py              # Flask backend (all routes)
├── templates/
│   ├── index.html      # Landing page
│   ├── login.html      # Admin login
│   └── admin.html      # Admin dashboard
├── uploads/            # Uploaded release files (gitignored)
├── requirements.txt    # Python dependencies
├── Procfile            # Railway/Heroku start command
├── railway.json        # Railway config
└── .gitignore
```

## ⚠️ Important note about Railway file storage

Railway's filesystem is **ephemeral** — files in `/uploads` are lost on redeploy.
For production, swap to S3/Cloudflare R2 for file storage. For small-scale use
(occasional releases), just re-upload after deploys.
