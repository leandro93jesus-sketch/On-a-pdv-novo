#define UNICODE
#define _UNICODE
#include <windows.h>
#include <shellapi.h>
#include <stdint.h>
#include <stdio.h>

static int is_test_mode(void) {
    LPWSTR cmd = GetCommandLineW();
    return (cmd && wcsstr(cmd, L"--test") != NULL);
}

int WINAPI wWinMain(HINSTANCE hInst, HINSTANCE hPrev, PWSTR cmdLine, int show) {
    wchar_t self[MAX_PATH];
    if (!GetModuleFileNameW(NULL, self, MAX_PATH)) {
        MessageBoxW(NULL, L"Nao foi possivel localizar o atualizador.", L"ONCA PDV PRO 0.1.12", MB_ICONERROR);
        return 1;
    }

    HANDLE h = CreateFileW(self, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (h == INVALID_HANDLE_VALUE) {
        MessageBoxW(NULL, L"Nao foi possivel abrir o atualizador.", L"ONCA PDV PRO 0.1.12", MB_ICONERROR);
        return 1;
    }

    LARGE_INTEGER size;
    if (!GetFileSizeEx(h, &size) || size.QuadPart < 8) {
        CloseHandle(h);
        MessageBoxW(NULL, L"Pacote de atualizacao invalido.", L"ONCA PDV PRO 0.1.12", MB_ICONERROR);
        return 1;
    }

    LARGE_INTEGER pos;
    pos.QuadPart = size.QuadPart - 8;
    SetFilePointerEx(h, pos, NULL, FILE_BEGIN);
    uint64_t payloadSize = 0;
    DWORD read = 0;
    if (!ReadFile(h, &payloadSize, 8, &read, NULL) || read != 8 || payloadSize == 0 || payloadSize > (uint64_t)(size.QuadPart - 8)) {
        CloseHandle(h);
        MessageBoxW(NULL, L"Pacote interno da atualizacao invalido.", L"ONCA PDV PRO 0.1.12", MB_ICONERROR);
        return 1;
    }
    CloseHandle(h);

    uint64_t offset = (uint64_t)size.QuadPart - 8ULL - payloadSize;

    wchar_t params[8192];
    _snwprintf_s(params, 8192, _TRUNCATE,
        L"-NoProfile -ExecutionPolicy Bypass -Command \"& { param($e,$o,$s) $ErrorActionPreference='Stop'; "
        L"$d=Join-Path $env:TEMP ('ONCA-PDV-PRO-0.1.12-'+[Guid]::NewGuid().ToString('N')); "
        L"New-Item -ItemType Directory -Force -Path $d|Out-Null; "
        L"$z=Join-Path $d 'payload.zip'; "
        L"$i=[IO.File]::OpenRead($e); try { $i.Seek([int64]$o,[IO.SeekOrigin]::Begin)|Out-Null; "
        L"$f=[IO.File]::Create($z); try { $i.CopyTo($f); $f.SetLength([int64]$s) } finally { $f.Dispose() } } finally { $i.Dispose() }; "
        L"Expand-Archive -LiteralPath $z -DestinationPath $d -Force; "
        L"& (Join-Path $d 'ONCA-PDV-PRO\\ATUALIZAR-ONCA-PDV-0.1.12.ps1') }\" "
        L"\"%s\" \"%llu\" \"%llu\"",
        self, (unsigned long long)offset, (unsigned long long)payloadSize);

    const wchar_t* verb = is_test_mode() ? L"open" : L"runas";
    HINSTANCE r = ShellExecuteW(NULL, verb, L"powershell.exe", params, NULL, SW_SHOWNORMAL);
    if ((INT_PTR)r <= 32) {
        MessageBoxW(NULL, L"Nao foi possivel iniciar a atualizacao. Execute como Administrador.", L"ONCA PDV PRO 0.1.12", MB_ICONERROR);
        return 1;
    }
    return 0;
}
