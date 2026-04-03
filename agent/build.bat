@echo off
echo ========================================
echo  Emote Control Agent - C++ Build
echo ========================================
echo.

:: Try MinGW (g++) first
where g++ >nul 2>&1
if %ERRORLEVEL% == 0 (
    echo [*] Found g++ ^(MinGW^) - Building...
    g++ -O2 -s -o EmoteAgent.exe agent.cpp -lwinhttp -lgdiplus -lgdi32 -lole32 -lws2_32 -lshell32 -luser32 -static-libgcc -static-libstdc++
    if %ERRORLEVEL% == 0 (
        echo [+] Build successful: EmoteAgent.exe
        for %%A in (EmoteAgent.exe) do echo     Size: %%~zA bytes
    ) else (
        echo [-] Build failed with g++
    )
    goto :done
)

:: Try MSVC (cl.exe)
where cl >nul 2>&1
if %ERRORLEVEL% == 0 (
    echo [*] Found cl.exe ^(MSVC^) - Building...
    cl /EHsc /O2 /Fe:EmoteAgent.exe agent.cpp winhttp.lib gdiplus.lib gdi32.lib ole32.lib ws2_32.lib shell32.lib user32.lib /link /SUBSYSTEM:CONSOLE
    if %ERRORLEVEL% == 0 (
        echo [+] Build successful: EmoteAgent.exe
        del *.obj 2>nul
    ) else (
        echo [-] Build failed with MSVC
    )
    goto :done
)

echo [-] No C++ compiler found!
echo     Install one of:
echo       - MinGW-w64: https://www.mingw-w64.org/
echo       - Visual Studio Build Tools: https://visualstudio.microsoft.com/downloads/
echo.
echo     If using MSVC, run this from "Developer Command Prompt for VS"

:done
echo.
pause
