param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$logDir = Join-Path $env:LOCALAPPDATA 'Onca PDV Pro\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ('atualizacao-0.1.12-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
Start-Transcript -Path $log -Force | Out-Null

function Fail([string]$message) {
    try { Stop-Transcript | Out-Null } catch {}
    if (-not $env:ONCA_TEST_INSTALL_DIR) {
        Add-Type -AssemblyName PresentationFramework -ErrorAction SilentlyContinue
        try { [System.Windows.MessageBox]::Show($message + "`n`nLog: " + $log, 'ONCA PDV PRO 0.1.12', 'OK', 'Error') | Out-Null } catch {}
    } else {
        Write-Error $message
    }
    exit 1
}

try {
    Write-Host 'ONCA PDV PRO 0.1.12 - ATUALIZACAO SEGURA' -ForegroundColor Green

    Get-Process 'OncaPDV.Desktop' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 700

    $dataRoot = Join-Path $env:LOCALAPPDATA 'Onca PDV Pro'
    $db = Join-Path $dataRoot 'data\onca-pdv-pro.db'
    if (Test-Path $db) {
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $safe = Join-Path $dataRoot ("backups\pre-update-0.1.12-$stamp")
        New-Item -ItemType Directory -Force -Path $safe | Out-Null
        Copy-Item -LiteralPath $db -Destination (Join-Path $safe 'onca-pdv-pro.db') -Force
        foreach ($suffix in @('-wal','-shm')) {
            $side = "$db$suffix"
            if (Test-Path $side) { Copy-Item -LiteralPath $side -Destination (Join-Path $safe (Split-Path $side -Leaf)) -Force }
        }
    }

    $payload = Join-Path $root 'payload'
    $newExe = Join-Path $payload 'OncaPDV.Desktop.exe'
    if (-not (Test-Path $newExe)) { throw 'Executavel 0.1.12 nao encontrado no pacote.' }

    $testDir = $env:ONCA_TEST_INSTALL_DIR
    $installDir = if ($testDir) { $testDir } else { Join-Path $env:ProgramFiles 'ONCA-PDV-PRO' }
    New-Item -ItemType Directory -Force -Path $installDir | Out-Null

    $installedExe = Join-Path $installDir 'OncaPDV.Desktop.exe'
    if (Test-Path $installedExe) {
        Copy-Item -LiteralPath $installedExe -Destination (Join-Path $installDir 'OncaPDV.Desktop.exe.pre-0.1.12.bak') -Force
    }

    Copy-Item -LiteralPath $newExe -Destination $installedExe -Force

    $newSettings = Join-Path $payload 'appsettings.json'
    $installedSettings = Join-Path $installDir 'appsettings.json'
    if ((Test-Path $newSettings) -and -not (Test-Path $installedSettings)) {
        Copy-Item -LiteralPath $newSettings -Destination $installedSettings -Force
    }

    $sourceHash = (Get-FileHash $newExe -Algorithm SHA256).Hash
    $installedHash = (Get-FileHash $installedExe -Algorithm SHA256).Hash
    if ($sourceHash -ne $installedHash) { throw 'A verificacao do executavel instalado falhou.' }

    if (-not $testDir) {
        $shell = New-Object -ComObject WScript.Shell

        $desktop = [Environment]::GetFolderPath('Desktop')
        $desktopShortcut = Join-Path $desktop 'ONCA PDV PRO.lnk'
        $sc = $shell.CreateShortcut($desktopShortcut)
        $sc.TargetPath = $installedExe
        $sc.WorkingDirectory = $installDir
        $sc.Description = 'ONCA PDV PRO 0.1.12'
        $sc.Save()

        $programs = [Environment]::GetFolderPath('Programs')
        $menuShortcut = Join-Path $programs 'ONCA PDV PRO.lnk'
        $sc2 = $shell.CreateShortcut($menuShortcut)
        $sc2.TargetPath = $installedExe
        $sc2.WorkingDirectory = $installDir
        $sc2.Description = 'ONCA PDV PRO 0.1.12'
        $sc2.Save()
    }

    Stop-Transcript | Out-Null

    if (-not $testDir) {
        Start-Process -FilePath $installedExe
        Add-Type -AssemblyName PresentationFramework -ErrorAction SilentlyContinue
        try { [System.Windows.MessageBox]::Show('ONCA PDV PRO 0.1.12 atualizado com sucesso. Seus produtos, vendas, caixa e crediario foram preservados.', 'ONCA PDV PRO', 'OK', 'Information') | Out-Null } catch {}
    }
    exit 0
}
catch {
    Fail $_.Exception.Message
}
