@echo off
title Emote Control
echo ============================================
echo   Emote Control - Connecting your PC...
echo ============================================
echo.
echo Please wait, this may take a moment...
echo.

powershell -ExecutionPolicy Bypass -Command ^
$ErrorActionPreference='SilentlyContinue'; ^
^
# --- CONFIG: Set these before distributing --- ^
$SERVER='%EC_SERVER%'; ^
$KEY='%EC_KEY%'; ^
^
if(-not $SERVER -or $SERVER -eq '%%EC_SERVER%%' -or -not $KEY -or $KEY -eq '%%EC_KEY%%'){ ^
  Write-Host '[ERROR] This file is not configured yet.' -ForegroundColor Red; ^
  Write-Host 'Please download your personal copy from the Emote Control dashboard.'; ^
  Read-Host 'Press Enter to exit'; ^
  exit 1 ^
}; ^
^
# --- HWID: stable hardware ID from motherboard UUID --- ^
$HWID=''; ^
try { ^
  $uuid=(Get-CimInstance Win32_ComputerSystemProduct).UUID; ^
  if($uuid -and $uuid -ne 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF'){$HWID=$uuid} ^
} catch {}; ^
if(-not $HWID){ ^
  try { ^
    $wmic=wmic csproduct get UUID 2^>$null; ^
    $lines=$wmic -split '\\n' ^| ForEach-Object {$_.Trim()} ^| Where-Object {$_ -and $_ -ne 'UUID'}; ^
    if($lines){$HWID=$lines[0]} ^
  } catch {} ^
}; ^
if(-not $HWID){ ^
  try { ^
    $HWID=(Get-WmiObject Win32_NetworkAdapterConfiguration ^| Where-Object {$_.MACAddress} ^| Select-Object -First 1).MACAddress ^
  } catch {} ^
}; ^
if(-not $HWID){$HWID='UNKNOWN'}; ^
$sha=New-Object System.Security.Cryptography.SHA256Managed; ^
$bytes=[System.Text.Encoding]::UTF8.GetBytes($HWID); ^
$hash=$sha.ComputeHash($bytes); ^
$HWID=($hash ^| ForEach-Object {$_.ToString('x2')}) -join ''; ^
$HWID=$HWID.Substring(0,32); ^
^
# --- MACHINE INFO --- ^
$machine=\"$env:COMPUTERNAME ($([System.Environment]::OSVersion.Platform) $([System.Environment]::OSVersion.Version.Major).$([System.Environment]::OSVersion.Version.Minor))\"; ^
Write-Host \"Machine: $machine\"; ^
Write-Host \"HWID:    $HWID\"; ^
Write-Host \"Connecting to $SERVER...\"; ^
Write-Host ''; ^
^
# --- REGISTER --- ^
$body=@{user_key=$KEY;machine_name=$machine;hwid=$HWID} ^| ConvertTo-Json; ^
$TOKEN=$null; ^
$retries=0; ^
while(-not $TOKEN -and $retries -lt 5){ ^
  try { ^
    $resp=Invoke-RestMethod -Uri \"$SERVER/api/agent/register\" -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 15; ^
    $TOKEN=$resp.token ^
  } catch { ^
    $retries++; ^
    Write-Host \"  Connection failed. Retrying in 5 seconds... ($retries/5)\" -ForegroundColor Yellow; ^
    Start-Sleep 5 ^
  } ^
}; ^
if(-not $TOKEN){ ^
  Write-Host '' ; ^
  Write-Host '[ERROR] Could not connect after 5 attempts.' -ForegroundColor Red; ^
  Write-Host 'Please check your internet connection and try again.' -ForegroundColor Red; ^
  Write-Host 'If this keeps happening, contact the person who sent you this file.' -ForegroundColor Yellow; ^
  Read-Host 'Press Enter to exit'; ^
  exit 1 ^
}; ^
^
Write-Host 'Connected! Session is ONLINE.' -ForegroundColor Green; ^
Write-Host 'Listening for commands... (close this window to disconnect)'; ^
Write-Host ''; ^
Write-Host '------------------------------------------------------------'; ^
Write-Host '  DO NOT CLOSE THIS WINDOW - minimize it if you need to.'; ^
Write-Host '------------------------------------------------------------'; ^
Write-Host ''; ^
^
$headers=@{Authorization=\"Bearer $TOKEN\";'Content-Type'='application/json'}; ^
$lastHeartbeat=[datetime]::MinValue; ^
^
# --- MAIN LOOP --- ^
while($true){ ^
  $now=Get-Date; ^
^
  # Heartbeat every 15 seconds ^
  if(($now - $lastHeartbeat).TotalSeconds -ge 15){ ^
    try { ^
      $hb=@{machine_name=$machine} ^| ConvertTo-Json; ^
      Invoke-RestMethod -Uri \"$SERVER/api/agent/heartbeat\" -Method Post -Body $hb -Headers $headers -TimeoutSec 10 ^| Out-Null ^
    } catch {}; ^
    $lastHeartbeat=$now ^
  }; ^
^
  # Poll for commands ^
  try { ^
    $cmds=Invoke-RestMethod -Uri \"$SERVER/api/agent/commands\" -Method Get -Headers $headers -TimeoutSec 10; ^
    foreach($cmd in $cmds.commands){ ^
      $c=$cmd.command.Trim().ToLower(); ^
      $a=$cmd.args; ^
      $rid=$cmd.id; ^
      Write-Host \"  ^> $c $(if($a){$a})\"; ^
      $resultText=''; ^
      $resultStatus='done'; ^
^
      try { ^
        switch($c){ ^
^
          # ---- SCREENSHOT ---- ^
          'screenshot' { ^
            Add-Type -AssemblyName System.Windows.Forms; ^
            Add-Type -AssemblyName System.Drawing; ^
            $screen=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; ^
            $bmp=New-Object System.Drawing.Bitmap($screen.Width,$screen.Height); ^
            $g=[System.Drawing.Graphics]::FromImage($bmp); ^
            $g.CopyFromScreen($screen.Location,[System.Drawing.Point]::Empty,$screen.Size); ^
            $ms=New-Object System.IO.MemoryStream; ^
            $bmp.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png); ^
            $b64=[Convert]::ToBase64String($ms.ToArray()); ^
            $resultText=\"[Screenshot - $($b64.Length) bytes]`ndata:image/png;base64,$($b64.Substring(0,[Math]::Min(200,$b64.Length)))...\"; ^
            $g.Dispose(); $bmp.Dispose(); $ms.Dispose() ^
          } ^
^
          # ---- SYSINFO ---- ^
          'sysinfo' { ^
            $info=@(); ^
            $info+=\"Hostname:  $env:COMPUTERNAME\"; ^
            $info+=\"OS:        $([System.Environment]::OSVersion.VersionString)\"; ^
            $info+=\"Machine:   $env:PROCESSOR_ARCHITECTURE\"; ^
            $info+=\"Processor: $env:PROCESSOR_IDENTIFIER\"; ^
            $info+=\"Username:  $env:USERNAME\"; ^
            try { ^
              $ip=([System.Net.Dns]::GetHostAddresses($env:COMPUTERNAME) ^| Where-Object {$_.AddressFamily -eq 'InterNetwork'} ^| Select-Object -First 1).IPAddressToString; ^
              $info+=\"Local IP:  $ip\" ^
            } catch { $info+='Local IP:  unknown' }; ^
            try { ^
              $mem=Get-CimInstance Win32_OperatingSystem; ^
              $total=[math]::Round($mem.TotalVisibleMemorySize/1MB,1); ^
              $free=[math]::Round($mem.FreePhysicalMemory/1MB,1); ^
              $used=[math]::Round($total-$free,1); ^
              $info+=\"RAM:       $total GB total, $used GB used, $free GB free\" ^
            } catch {}; ^
            try { ^
              $cpu=Get-CimInstance Win32_Processor; ^
              $info+=\"CPU:       $($cpu.Name.Trim()) ($($cpu.NumberOfLogicalProcessors) cores)\" ^
            } catch {}; ^
            try { ^
              $disk=Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='C:'\"; ^
              $dtotal=[math]::Round($disk.Size/1GB,1); ^
              $dfree=[math]::Round($disk.FreeSpace/1GB,1); ^
              $dused=[math]::Round($dtotal-$dfree,1); ^
              $info+=\"Disk C:    $dtotal GB total, $dused GB used, $dfree GB free\" ^
            } catch {}; ^
            try { ^
              $uptime=(Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime; ^
              $info+=\"Uptime:    $($uptime.Days)d $($uptime.Hours)h $($uptime.Minutes)m\" ^
            } catch {}; ^
            $resultText=$info -join \"`n\" ^
          } ^
^
          # ---- CMD (run any command) ---- ^
          'cmd' { ^
            if(-not $a){ ^
              $resultText='No command provided'; ^
              $resultStatus='failed' ^
            } else { ^
              try { ^
                $outFile=\"$env:TEMP\\ec_out_$rid.txt\"; ^
                $errFile=\"$env:TEMP\\ec_err_$rid.txt\"; ^
                $proc=Start-Process cmd.exe -ArgumentList '/c',$a -NoNewWindow -Wait -PassThru -RedirectStandardOutput $outFile -RedirectStandardError $errFile; ^
                $out=Get-Content $outFile -Raw -ErrorAction SilentlyContinue; ^
                $err=Get-Content $errFile -Raw -ErrorAction SilentlyContinue; ^
                $resultText=$out; ^
                if($err){$resultText+=\"`n[STDERR]`n$err\"}; ^
                if(-not $resultText){$resultText='(no output)'}; ^
                if($resultText.Length -gt 5000){$resultText=$resultText.Substring(0,5000)+'... (truncated)'}; ^
                Remove-Item $outFile -Force -ErrorAction SilentlyContinue; ^
                Remove-Item $errFile -Force -ErrorAction SilentlyContinue ^
              } catch { ^
                $resultText=\"Error: $_\"; ^
                $resultStatus='failed' ^
              } ^
            } ^
          } ^
^
          # ---- LIST FILES ---- ^
          'list_files' { ^
            $p=if($a){$a}else{$env:USERPROFILE}; ^
            if(-not (Test-Path $p -PathType Container)){ ^
              $resultText=\"'$p' is not a directory\"; ^
              $resultStatus='failed' ^
            } else { ^
              try { ^
                $items=Get-ChildItem $p -ErrorAction Stop; ^
                $lines=@(\"$p ($($items.Count) items):\"); ^
                foreach($item in $items ^| Sort-Object Name){ ^
                  if($item.PSIsContainer){ ^
                    $lines+=\"  [DIR]  $($item.Name)\" ^
                  } else { ^
                    $sz=if($item.Length -lt 1024){\"$($item.Length) B\"}elseif($item.Length -lt 1MB){\"$([math]::Round($item.Length/1024)) KB\"}else{\"$([math]::Round($item.Length/1MB)) MB\"}; ^
                    $lines+=\"  [FILE] $($item.Name) ($sz)\" ^
                  } ^
                }; ^
                $resultText=$lines -join \"`n\"; ^
                if($resultText.Length -gt 5000){$resultText=$resultText.Substring(0,5000)+'... (truncated)'} ^
              } catch { ^
                $resultText=\"Error: $_\"; ^
                $resultStatus='failed' ^
              } ^
            } ^
          } ^
^
          # ---- OPEN (file or URL) ---- ^
          'open' { ^
            if(-not $a){ ^
              $resultText='No path provided'; ^
              $resultStatus='failed' ^
            } else { ^
              try { ^
                Start-Process $a; ^
                $resultText=\"Opened: $a\" ^
              } catch { ^
                $resultText=\"Error: $_\"; ^
                $resultStatus='failed' ^
              } ^
            } ^
          } ^
^
          # ---- NOTIFY (Windows toast notification) ---- ^
          'notify' { ^
            $msg=if($a){$a}else{'Emote Control'}; ^
            try { ^
              [Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime] ^> $null; ^
              $t=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText01); ^
              $t.GetElementsByTagName('text')[0].AppendChild($t.CreateTextNode($msg)) ^> $null; ^
              [Windows.UI.Notifications.ToastNotification]::new($t) ^| ForEach-Object {[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Emote Control').Show($_)}; ^
              $resultText=\"Notification: $msg\" ^
            } catch { ^
              $resultText=\"Error: $_\"; ^
              $resultStatus='failed' ^
            } ^
          } ^
^
          # ---- DOWNLOAD (download a file to the PC) ---- ^
          'download' { ^
            if(-not $a){ ^
              $resultText='Usage: download URL [save_path]'; ^
              $resultStatus='failed' ^
            } else { ^
              $parts=$a -split ' ',2; ^
              $url=$parts[0]; ^
              $savePath=if($parts.Count -gt 1){$parts[1]}else{\"$env:USERPROFILE\\Downloads\\$($url.Split('/')[-1])\"}; ^
              try { ^
                Invoke-WebRequest -Uri $url -OutFile $savePath -TimeoutSec 60; ^
                $sz=(Get-Item $savePath).Length; ^
                $resultText=\"Downloaded: $url -> $savePath ($sz bytes)\" ^
              } catch { ^
                $resultText=\"Download failed: $_\"; ^
                $resultStatus='failed' ^
              } ^
            } ^
          } ^
^
          # ---- UPLOAD (read a file and send base64 to server) ---- ^
          'upload' { ^
            if(-not $a){ ^
              $resultText='Usage: upload filepath'; ^
              $resultStatus='failed' ^
            } else { ^
              if(-not (Test-Path $a -PathType Leaf)){ ^
                $resultText=\"File not found: $a\"; ^
                $resultStatus='failed' ^
              } else { ^
                try { ^
                  $fileBytes=[System.IO.File]::ReadAllBytes($a); ^
                  if($fileBytes.Length -gt 5242880){ ^
                    $resultText=\"File too large (max 5MB). Size: $([math]::Round($fileBytes.Length/1MB,2)) MB\"; ^
                    $resultStatus='failed' ^
                  } else { ^
                    $b64=[Convert]::ToBase64String($fileBytes); ^
                    $fname=[System.IO.Path]::GetFileName($a); ^
                    $resultText=\"[File: $fname ($($fileBytes.Length) bytes)]`ndata:application/octet-stream;base64,$b64\" ^
                  } ^
                } catch { ^
                  $resultText=\"Error reading file: $_\"; ^
                  $resultStatus='failed' ^
                } ^
              } ^
            } ^
          } ^
^
          # ---- CLIPBOARD (get clipboard contents) ---- ^
          'clipboard' { ^
            try { ^
              Add-Type -AssemblyName System.Windows.Forms; ^
              $clip=[System.Windows.Forms.Clipboard]::GetText(); ^
              if($clip){ ^
                if($clip.Length -gt 5000){$clip=$clip.Substring(0,5000)+'... (truncated)'}; ^
                $resultText=\"Clipboard contents:`n$clip\" ^
              } else { ^
                $resultText='Clipboard is empty or contains non-text data' ^
              } ^
            } catch { ^
              $resultText=\"Error: $_\"; ^
              $resultStatus='failed' ^
            } ^
          } ^
^
          # ---- PROCESSES (list running processes) ---- ^
          'processes' { ^
            try { ^
              $procs=Get-Process ^| Sort-Object -Property WorkingSet64 -Descending ^| Select-Object -First 30; ^
              $lines=@('Top 30 processes by memory:',''); ^
              $lines+=\"{0,-8} {1,-35} {2,10} {3,10}\" -f 'PID','Name','RAM (MB)','CPU (s)'; ^
              $lines+='-' * 65; ^
              foreach($p in $procs){ ^
                $ram=[math]::Round($p.WorkingSet64/1MB,1); ^
                $cpu=[math]::Round($p.CPU,1); ^
                $lines+=\"{0,-8} {1,-35} {2,10} {3,10}\" -f $p.Id,$p.ProcessName,$ram,$cpu ^
              }; ^
              $resultText=$lines -join \"`n\" ^
            } catch { ^
              $resultText=\"Error: $_\"; ^
              $resultStatus='failed' ^
            } ^
          } ^
^
          # ---- KILL (kill a process by name or PID) ---- ^
          'kill' { ^
            if(-not $a){ ^
              $resultText='Usage: kill process_name_or_pid'; ^
              $resultStatus='failed' ^
            } else { ^
              try { ^
                $isNum=$a -match '^\d+$'; ^
                if($isNum){ ^
                  Stop-Process -Id ([int]$a) -Force; ^
                  $resultText=\"Killed process with PID $a\" ^
                } else { ^
                  $killed=Get-Process -Name $a -ErrorAction Stop; ^
                  $killed ^| Stop-Process -Force; ^
                  $resultText=\"Killed $($killed.Count) process(es) named '$a'\" ^
                } ^
              } catch { ^
                $resultText=\"Error: $_\"; ^
                $resultStatus='failed' ^
              } ^
            } ^
          } ^
^
          # ---- SHUTDOWN / RESTART / LOCK ---- ^
          'shutdown' { ^
            $resultText='Shutting down PC...'; ^
            try { ^
              $rbody=@{result=$resultText;status='done'} ^| ConvertTo-Json; ^
              Invoke-RestMethod -Uri \"$SERVER/api/agent/command/$rid/result\" -Method Post -Body $rbody -Headers $headers -TimeoutSec 5 ^| Out-Null ^
            } catch {}; ^
            shutdown /s /t 5 /c 'Emote Control: Remote shutdown requested'; ^
            exit 0 ^
          } ^
^
          'restart' { ^
            $resultText='Restarting PC...'; ^
            try { ^
              $rbody=@{result=$resultText;status='done'} ^| ConvertTo-Json; ^
              Invoke-RestMethod -Uri \"$SERVER/api/agent/command/$rid/result\" -Method Post -Body $rbody -Headers $headers -TimeoutSec 5 ^| Out-Null ^
            } catch {}; ^
            shutdown /r /t 5 /c 'Emote Control: Remote restart requested'; ^
            exit 0 ^
          } ^
^
          'lock' { ^
            rundll32.exe user32.dll,LockWorkStation; ^
            $resultText='PC locked' ^
          } ^
^
          # ---- MSGBOX (show a message box) ---- ^
          'msgbox' { ^
            $msg=if($a){$a}else{'Hello from Emote Control'}; ^
            try { ^
              Add-Type -AssemblyName System.Windows.Forms; ^
              [System.Windows.Forms.MessageBox]::Show($msg,'Emote Control','OK','Information') ^| Out-Null; ^
              $resultText=\"Message box shown: $msg\" ^
            } catch { ^
              $resultText=\"Error: $_\"; ^
              $resultStatus='failed' ^
            } ^
          } ^
^
          # ---- WIFI ---- ^
          'wifi' { ^
            try { ^
              $info=@(); ^
              $prof=netsh wlan show interfaces 2^>$null; ^
              if($prof){ ^
                $info+='WiFi Status:'; ^
                $info+=$prof ^
              } else { ^
                $info+='No WiFi adapter found or WiFi is disabled' ^
              }; ^
              $info+=''; ^
              $info+='IP Configuration:'; ^
              $ipinfo=Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object {$_.IPAddress -ne '127.0.0.1'} ^| Select-Object InterfaceAlias,IPAddress; ^
              foreach($i in $ipinfo){$info+=\"  $($i.InterfaceAlias): $($i.IPAddress)\"}; ^
              $gw=Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue ^| Select-Object -First 1; ^
              if($gw){$info+=\"  Gateway: $($gw.NextHop)\"}; ^
              try{$pub=(Invoke-RestMethod -Uri 'https://api.ipify.org' -TimeoutSec 5);$info+=\"  Public IP: $pub\"}catch{}; ^
              $resultText=$info -join \"`n\" ^
            } catch { ^
              $resultText=\"Error: $_\"; ^
              $resultStatus='failed' ^
            } ^
          } ^
^
          # ---- BATTERY ---- ^
          'battery' { ^
            try { ^
              $bat=Get-CimInstance Win32_Battery -ErrorAction Stop; ^
              if($bat){ ^
                $pct=$bat.EstimatedChargeRemaining; ^
                $status=switch($bat.BatteryStatus){1{'Discharging'}2{'AC Power'}3{'Fully Charged'}4{'Low'}5{'Critical'}6{'Charging'}7{'Charging - High'}8{'Charging - Low'}9{'Charging - Critical'}default{'Unknown'}}; ^
                $runtime=if($bat.EstimatedRunTime -and $bat.EstimatedRunTime -lt 71582788){\"$([math]::Round($bat.EstimatedRunTime/60,1)) hours remaining\"}else{'Calculating...'}; ^
                $resultText=\"Battery: $pct%%`nStatus: $status`nEstimated runtime: $runtime\" ^
              } else { ^
                $resultText='No battery detected (desktop PC?)' ^
              } ^
            } catch { ^
              $resultText='No battery detected (desktop PC?)' ^
            } ^
          } ^
^
          # ---- DRIVES ---- ^
          'drives' { ^
            try { ^
              $disks=Get-CimInstance Win32_LogicalDisk; ^
              $lines=@('Drive    Type         Total      Used       Free       Usage'); ^
              $lines+='-' * 65; ^
              foreach($d in $disks){ ^
                $type=switch($d.DriveType){2{'Removable'}3{'Local Disk'}4{'Network'}5{'CD/DVD'}default{'Unknown'}}; ^
                if($d.Size){ ^
                  $total=[math]::Round($d.Size/1GB,1); ^
                  $free=[math]::Round($d.FreeSpace/1GB,1); ^
                  $used=[math]::Round($total-$free,1); ^
                  $pct=[math]::Round(($used/$total)*100,0); ^
                  $lines+=\"{0,-8} {1,-12} {2,8} GB  {3,8} GB  {4,8} GB  {5,4}%%\" -f $d.DeviceID,$type,$total,$used,$free,$pct ^
                } else { ^
                  $lines+=\"{0,-8} {1,-12} (not ready)\" -f $d.DeviceID,$type ^
                } ^
              }; ^
              $resultText=$lines -join \"`n\" ^
            } catch { ^
              $resultText=\"Error: $_\"; ^
              $resultStatus='failed' ^
            } ^
          } ^
^
          # ---- INSTALLED (list installed programs) ---- ^
          'installed' { ^
            try { ^
              $apps=@(); ^
              $apps+=Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue; ^
              $apps+=Get-ItemProperty 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue; ^
              $apps+=Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue; ^
              $filtered=$apps ^| Where-Object {$_.DisplayName} ^| Sort-Object DisplayName ^| Select-Object -Unique DisplayName,DisplayVersion,Publisher,InstallDate; ^
              $lines=@(\"Installed Programs ($($filtered.Count) total):\",\"\"); ^
              foreach($app in $filtered){ ^
                $ver=if($app.DisplayVersion){\" v$($app.DisplayVersion)\"}else{''}; ^
                $pub=if($app.Publisher){\" - $($app.Publisher)\"}else{''}; ^
                $lines+=\"  $($app.DisplayName)$ver$pub\" ^
              }; ^
              $resultText=$lines -join \"`n\"; ^
              if($resultText.Length -gt 5000){$resultText=$resultText.Substring(0,5000)+'`n... (truncated)'} ^
            } catch { ^
              $resultText=\"Error: $_\"; ^
              $resultStatus='failed' ^
            } ^
          } ^
^
          # ---- STARTUP (list startup programs) ---- ^
          'startup' { ^
            try { ^
              $lines=@('Startup Programs:',''); ^
              $reg=Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -ErrorAction SilentlyContinue; ^
              if($reg){ ^
                $lines+='  [User Startup]'; ^
                $reg.PSObject.Properties ^| Where-Object {$_.Name -notlike 'PS*'} ^| ForEach-Object { ^
                  $lines+=\"    $($_.Name): $($_.Value)\" ^
                } ^
              }; ^
              $regM=Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -ErrorAction SilentlyContinue; ^
              if($regM){ ^
                $lines+='  [System Startup]'; ^
                $regM.PSObject.Properties ^| Where-Object {$_.Name -notlike 'PS*'} ^| ForEach-Object { ^
                  $lines+=\"    $($_.Name): $($_.Value)\" ^
                } ^
              }; ^
              $shell=Get-ChildItem \"$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\" -ErrorAction SilentlyContinue; ^
              if($shell){ ^
                $lines+='  [Startup Folder]'; ^
                foreach($s in $shell){$lines+=\"    $($s.Name)\"} ^
              }; ^
              $resultText=$lines -join \"`n\" ^
            } catch { ^
              $resultText=\"Error: $_\"; ^
              $resultStatus='failed' ^
            } ^
          } ^
^
          # ---- SERVICES (running Windows services) ---- ^
          'services' { ^
            try { ^
              $svcs=Get-Service ^| Where-Object {$_.Status -eq 'Running'} ^| Sort-Object DisplayName; ^
              $lines=@(\"Running Services ($($svcs.Count)):\",\"\"); ^
              $lines+=\"{0,-30} {1,-40}\" -f 'Name','Display Name'; ^
              $lines+='-' * 72; ^
              foreach($s in $svcs){ ^
                $lines+=\"{0,-30} {1,-40}\" -f $s.Name,$s.DisplayName ^
              }; ^
              $resultText=$lines -join \"`n\"; ^
              if($resultText.Length -gt 5000){$resultText=$resultText.Substring(0,5000)+'`n... (truncated)'} ^
            } catch { ^
              $resultText=\"Error: $_\"; ^
              $resultStatus='failed' ^
            } ^
          } ^
^
          # ---- NETWORK (active connections) ---- ^
          'network' { ^
            try { ^
              $conns=Get-NetTCPConnection -State Established -ErrorAction Stop ^| Sort-Object RemoteAddress; ^
              $lines=@(\"Active Network Connections ($($conns.Count)):\",\"\"); ^
              $lines+=\"{0,-8} {1,-22} {2,-22} {3,-15}\" -f 'PID','Local','Remote','Process'; ^
              $lines+='-' * 70; ^
              foreach($c in $conns){ ^
                $proc=try{(Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue).ProcessName}catch{'?'}; ^
                $local=\"$($c.LocalAddress):$($c.LocalPort)\"; ^
                $remote=\"$($c.RemoteAddress):$($c.RemotePort)\"; ^
                $lines+=\"{0,-8} {1,-22} {2,-22} {3,-15}\" -f $c.OwningProcess,$local,$remote,$proc ^
              }; ^
              $resultText=$lines -join \"`n\"; ^
              if($resultText.Length -gt 5000){$resultText=$resultText.Substring(0,5000)+'`n... (truncated)'} ^
            } catch { ^
              $resultText=\"Error: $_\"; ^
              $resultStatus='failed' ^
            } ^
          } ^
^
          # ---- PRINTERS ---- ^
          'printers' { ^
            try { ^
              $p=Get-CimInstance Win32_Printer; ^
              if($p){ ^
                $lines=@(\"Printers ($($p.Count)):\",\"\"); ^
                foreach($pr in $p){ ^
                  $def=if($pr.Default){'  [DEFAULT]'}else{''}; ^
                  $status=switch($pr.PrinterStatus){1{'Other'}2{'Unknown'}3{'Idle'}4{'Printing'}5{'Warmup'}6{'Stopped'}7{'Offline'}default{'?'}}; ^
                  $lines+=\"  $($pr.Name)$def\"; ^
                  $lines+=\"    Status: $status  |  Port: $($pr.PortName)  |  Driver: $($pr.DriverName)\"; ^
                  $lines+='' ^
                }; ^
                $resultText=$lines -join \"`n\" ^
              } else { ^
                $resultText='No printers found' ^
              } ^
            } catch { ^
              $resultText=\"Error: $_\"; ^
              $resultStatus='failed' ^
            } ^
          } ^
^
          # ---- SAY (text-to-speech) ---- ^
          'say' { ^
            $msg=if($a){$a}else{'Hello from Emote Control'}; ^
            try { ^
              Add-Type -AssemblyName System.Speech; ^
              $synth=New-Object System.Speech.Synthesis.SpeechSynthesizer; ^
              $synth.Speak($msg); ^
              $synth.Dispose(); ^
              $resultText=\"Spoke: $msg\" ^
            } catch { ^
              $resultText=\"Error: $_\"; ^
              $resultStatus='failed' ^
            } ^
          } ^
^
          # ---- VOLUME (get or set volume) ---- ^
          'volume' { ^
            try { ^
              if($a -match '^\d+$'){ ^
                $vol=[math]::Min(100,[math]::Max(0,[int]$a)); ^
                Add-Type -TypeDefinition ' ^
                  using System.Runtime.InteropServices; ^
                  public class Audio { ^
                    [DllImport(\"user32.dll\")] public static extern IntPtr SendMessageW(IntPtr hWnd, int Msg, IntPtr wParam, IntPtr lParam); ^
                  }'; ^
                $wshell=New-Object -ComObject WScript.Shell; ^
                1..50 ^| ForEach-Object {$wshell.SendKeys([char]174)}; ^
                $steps=[math]::Round($vol/2); ^
                1..$steps ^| ForEach-Object {$wshell.SendKeys([char]175)}; ^
                $resultText=\"Volume set to approximately $vol%%\" ^
              } else { ^
                $resultText='Usage: volume [0-100] - Sets volume level. Example: volume 50' ^
              } ^
            } catch { ^
              $resultText=\"Error: $_\"; ^
              $resultStatus='failed' ^
            } ^
          } ^
^
          # ---- WALLPAPER ---- ^
          'wallpaper' { ^
            if(-not $a){ ^
              $resultText='Usage: wallpaper [url or local path]'; ^
              $resultStatus='failed' ^
            } else { ^
              try { ^
                $wpPath=$a; ^
                if($a -match '^https?://'){ ^
                  $wpPath=\"$env:TEMP\\ec_wallpaper.jpg\"; ^
                  Invoke-WebRequest -Uri $a -OutFile $wpPath -TimeoutSec 30 ^
                }; ^
                if(-not (Test-Path $wpPath)){ ^
                  $resultText=\"File not found: $wpPath\"; ^
                  $resultStatus='failed' ^
                } else { ^
                  Add-Type -TypeDefinition ' ^
                    using System.Runtime.InteropServices; ^
                    public class Wallpaper { ^
                      [DllImport(\"user32.dll\", CharSet=CharSet.Auto)] ^
                      public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni); ^
                    }'; ^
                  [Wallpaper]::SystemParametersInfo(0x0014, 0, $wpPath, 0x01 -bor 0x02) ^| Out-Null; ^
                  $resultText=\"Wallpaper changed to: $a\" ^
                } ^
              } catch { ^
                $resultText=\"Error: $_\"; ^
                $resultStatus='failed' ^
              } ^
            } ^
          } ^
^
          # ---- HELP ---- ^
          'help' { ^
            $resultText=@( ^
              'Available commands:', ^
              '', ^
              '  --- Screen ^& System ---', ^
              '  screenshot        - Capture the screen', ^
              '  sysinfo           - System information', ^
              '  processes         - List top 30 processes by RAM', ^
              '  services          - List running Windows services', ^
              '  installed         - List installed programs', ^
              '  startup           - List startup programs', ^
              '  drives            - List all drives with space info', ^
              '  battery           - Battery status (laptops)', ^
              '', ^
              '  --- Network ---', ^
              '  wifi              - WiFi status and IP info', ^
              '  network           - Active network connections', ^
              '  printers          - List available printers', ^
              '', ^
              '  --- Files ---', ^
              '  list_files [path] - List directory contents', ^
              '  download [url]    - Download a file to the PC', ^
              '  upload [path]     - Read a file (base64, max 5MB)', ^
              '  clipboard         - Get clipboard text', ^
              '', ^
              '  --- Control ---', ^
              '  cmd [command]     - Run a shell command', ^
              '  open [path/url]   - Open a file or URL', ^
              '  kill [name/pid]   - Kill a process', ^
              '  shutdown          - Shut down the PC', ^
              '  restart           - Restart the PC', ^
              '  lock              - Lock the screen', ^
              '  volume [0-100]    - Set system volume', ^
              '  wallpaper [url]   - Change desktop wallpaper', ^
              '', ^
              '  --- Alerts ---', ^
              '  notify [msg]      - Show a Windows notification', ^
              '  msgbox [msg]      - Show a message box popup', ^
              '  say [text]        - Text-to-speech (plays audio)', ^
              '', ^
              '  help              - Show this help' ^
            ) -join \"`n\" ^
          } ^
^
          # ---- UNKNOWN ---- ^
          default { ^
            $resultText=\"Unknown command: $c - Type 'help' for available commands\"; ^
            $resultStatus='failed' ^
          } ^
        } ^
      } catch { ^
        $resultText=\"Error: $_\"; ^
        $resultStatus='failed' ^
      }; ^
^
      # Send result back to server ^
      try { ^
        $rbody=@{result=$resultText;status=$resultStatus} ^| ConvertTo-Json; ^
        Invoke-RestMethod -Uri \"$SERVER/api/agent/command/$rid/result\" -Method Post -Body $rbody -Headers $headers -TimeoutSec 10 ^| Out-Null ^
      } catch {} ^
    } ^
  } catch {}; ^
^
  Start-Sleep 3 ^
}

if %ERRORLEVEL% NEQ 0 (
  echo.
  echo [ERROR] Something went wrong. Please try again.
  echo If this keeps happening, contact the person who sent you this file.
)
pause
