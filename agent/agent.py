"""
Emote Control — Remote Agent
Zero-config: reads config.txt from same folder, auto-registers, auto-connects.
Build exe: pyinstaller --onefile --name EmoteAgent agent.py
"""

import os
import sys
import time
import json
import socket
import platform
import subprocess
import base64
import io
import threading
import traceback

try:
    import requests
except ImportError:
    print("[!] 'requests' not installed. Run: pip install requests")
    input("Press Enter to exit...")
    sys.exit(1)

try:
    import pyautogui
except ImportError:
    pyautogui = None

try:
    import psutil
except ImportError:
    psutil = None


# ============================================================
# CONFIG
# ============================================================

SERVER = "https://vortex-cs2.com"
HEARTBEAT_INTERVAL = 15
POLL_INTERVAL = 3
TOKEN = None


def get_exe_dir():
    """Get directory where the exe (or script) lives."""
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def load_config():
    """Load user_key from config.txt next to the exe."""
    config_path = os.path.join(get_exe_dir(), "config.txt")
    if not os.path.exists(config_path):
        print("[!] config.txt not found!")
        print(f"    Expected at: {config_path}")
        print("    Download it from your Emote Control dashboard.")
        input("\nPress Enter to exit...")
        sys.exit(1)

    try:
        with open(config_path, "r") as f:
            data = json.loads(f.read())
        return data.get("user_key")
    except Exception as e:
        print(f"[!] Failed to read config.txt: {e}")
        input("\nPress Enter to exit...")
        sys.exit(1)


def get_machine_name():
    return f"{platform.node()} ({platform.system()} {platform.release()})"


def register(user_key):
    """Register with the server, get a session token."""
    global TOKEN
    try:
        resp = requests.post(
            f"{SERVER}/api/agent/register",
            json={"user_key": user_key, "machine_name": get_machine_name()},
            timeout=10,
        )
        if resp.status_code == 200:
            data = resp.json()
            TOKEN = data["token"]
            return True
        else:
            print(f"[!] Registration failed: {resp.status_code} — {resp.text}")
            return False
    except Exception as e:
        print(f"[!] Could not reach server: {e}")
        return False


def headers():
    return {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}


# ============================================================
# HEARTBEAT
# ============================================================

def send_heartbeat():
    try:
        requests.post(
            f"{SERVER}/api/agent/heartbeat",
            json={"machine_name": get_machine_name()},
            headers=headers(),
            timeout=10,
        )
    except Exception:
        pass


def heartbeat_loop():
    while True:
        send_heartbeat()
        time.sleep(HEARTBEAT_INTERVAL)


# ============================================================
# COMMAND HANDLERS
# ============================================================

def handle_screenshot(args):
    if not pyautogui:
        return "Error: pyautogui not installed", "failed"
    try:
        img = pyautogui.screenshot()
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
        return f"[Screenshot taken — {len(b64)} bytes base64]\ndata:image/png;base64,{b64[:200]}...", "done"
    except Exception as e:
        return f"Screenshot error: {e}", "failed"


def handle_sysinfo(args):
    info = [
        f"Hostname:  {platform.node()}",
        f"OS:        {platform.system()} {platform.release()} ({platform.version()})",
        f"Machine:   {platform.machine()}",
        f"Processor: {platform.processor()}",
        f"Python:    {platform.python_version()}",
    ]
    try:
        ip = socket.gethostbyname(socket.gethostname())
        info.append(f"Local IP:  {ip}")
    except Exception:
        info.append("Local IP:  unknown")

    if psutil:
        mem = psutil.virtual_memory()
        info.append(f"RAM:       {mem.total // (1024**3)} GB total, {mem.percent}% used")
        info.append(f"CPU:       {psutil.cpu_count()} cores, {psutil.cpu_percent()}% used")
        disk = psutil.disk_usage("/")
        info.append(f"Disk:      {disk.total // (1024**3)} GB total, {disk.percent}% used")

    return "\n".join(info), "done"


def handle_cmd(args):
    if not args:
        return "Error: no command provided", "failed"
    try:
        result = subprocess.run(
            args, shell=True, capture_output=True, text=True,
            timeout=30, cwd=os.path.expanduser("~"),
        )
        output = ""
        if result.stdout:
            output += result.stdout
        if result.stderr:
            output += "\n[STDERR]\n" + result.stderr
        return (output.strip() or "(no output)")[:5000], "done"
    except subprocess.TimeoutExpired:
        return "Error: command timed out (30s limit)", "failed"
    except Exception as e:
        return f"Error: {e}", "failed"


def handle_list_files(args):
    path = args if args else os.path.expanduser("~")
    try:
        if not os.path.isdir(path):
            return f"Error: '{path}' is not a directory", "failed"
        entries = os.listdir(path)
        lines = []
        for entry in sorted(entries):
            full = os.path.join(path, entry)
            if os.path.isdir(full):
                lines.append(f"  [DIR]  {entry}")
            else:
                try:
                    size = os.path.getsize(full)
                    sz = f"{size} B" if size < 1024 else f"{size//1024} KB" if size < 1024*1024 else f"{size//(1024*1024)} MB"
                    lines.append(f"  [FILE] {entry} ({sz})")
                except Exception:
                    lines.append(f"  [FILE] {entry}")
        return (f"Contents of {path} ({len(entries)} items):\n" + "\n".join(lines))[:5000], "done"
    except PermissionError:
        return f"Error: permission denied for '{path}'", "failed"
    except Exception as e:
        return f"Error: {e}", "failed"


def handle_open(args):
    if not args:
        return "Error: no path/app provided", "failed"
    try:
        if platform.system() == "Windows":
            os.startfile(args)
        elif platform.system() == "Darwin":
            subprocess.Popen(["open", args])
        else:
            subprocess.Popen(["xdg-open", args])
        return f"Opened: {args}", "done"
    except Exception as e:
        return f"Error: {e}", "failed"


def handle_notify(args):
    msg = args if args else "Emote Control notification"
    try:
        if platform.system() == "Windows":
            ps = f'''
            [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
            $t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText01)
            $t.GetElementsByTagName("text")[0].AppendChild($t.CreateTextNode("{msg}")) > $null
            [Windows.UI.Notifications.ToastNotification]::new($t) | ForEach-Object {{ [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Emote Control").Show($_) }}
            '''
            subprocess.run(["powershell", "-Command", ps], capture_output=True, timeout=10)
        else:
            subprocess.run(["notify-send", "Emote Control", msg], capture_output=True, timeout=5)
        return f"Notification sent: {msg}", "done"
    except Exception as e:
        return f"Notification error: {e}", "failed"


COMMANDS = {
    "screenshot": handle_screenshot,
    "sysinfo": handle_sysinfo,
    "cmd": handle_cmd,
    "list_files": handle_list_files,
    "open": handle_open,
    "notify": handle_notify,
}


def execute_command(cmd_id, command, args):
    handler = COMMANDS.get(command)
    if handler:
        try:
            result = handler(args)
            text, status = result if isinstance(result, tuple) else (result, "done")
        except Exception:
            text, status = f"Unhandled error: {traceback.format_exc()}", "failed"
    else:
        text = f"Unknown command: {command}\nAvailable: {', '.join(COMMANDS.keys())}"
        status = "failed"

    try:
        requests.post(
            f"{SERVER}/api/agent/command/{cmd_id}/result",
            json={"result": text, "status": status},
            headers=headers(),
            timeout=10,
        )
    except Exception as e:
        print(f"  [!] Failed to post result: {e}")


# ============================================================
# MAIN
# ============================================================

def poll_commands():
    try:
        resp = requests.get(f"{SERVER}/api/agent/commands", headers=headers(), timeout=10)
        if resp.status_code != 200:
            return
        for cmd in resp.json().get("commands", []):
            print(f"  [>] {cmd['command']}" + (f" {cmd['args']}" if cmd.get('args') else ""))
            execute_command(cmd["id"], cmd["command"].strip().lower(), cmd.get("args"))
    except requests.exceptions.ConnectionError:
        pass
    except Exception as e:
        print(f"  [!] Poll error: {e}")


def main():
    print("Emote Control Agent")
    print("=" * 40)

    # Load config
    user_key = load_config()
    print(f"[*] Server: {SERVER}")
    print(f"[*] Key:    {user_key[:16]}...")

    # Register
    print("[*] Registering session...")
    if register(user_key):
        print("[+] Connected! Session is ONLINE.")
    else:
        print("[!] Failed to register. Retrying in 5s...")
        time.sleep(5)
        if not register(user_key):
            print("[!] Could not connect. Check your internet and config.txt.")
            input("\nPress Enter to exit...")
            sys.exit(1)

    # Heartbeat thread
    threading.Thread(target=heartbeat_loop, daemon=True).start()

    print("[*] Listening for commands...\n")

    try:
        while True:
            poll_commands()
            time.sleep(POLL_INTERVAL)
    except KeyboardInterrupt:
        print("\n[*] Agent stopped.")


if __name__ == "__main__":
    main()
