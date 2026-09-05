$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host '=== ONCA-PDV-PRO 0.1.3 - FINALIZACAO LOCAL ===' -ForegroundColor Green

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
    throw '.NET SDK 10 nao encontrado. Instale o .NET 10 SDK e execute novamente.'
}

Write-Host '[1/5] Restaurando pacotes...'
dotnet restore .\OncaPDV.slnx --configfile .\NuGet.Config
if ($LASTEXITCODE -ne 0) { throw 'Falha no dotnet restore.' }

Write-Host '[2/5] Testando...'
dotnet test .\OncaPDV.slnx -c Release --no-restore
if ($LASTEXITCODE -ne 0) { throw 'Falha nos testes. Nao sera gerado instalador.' }

Write-Host '[3/5] Build Release...'
dotnet build .\OncaPDV.slnx -c Release --no-restore
if ($LASTEXITCODE -ne 0) { throw 'Falha no build Release.' }

Write-Host '[4/5] Publicando self-contained win-x64...'
$publish = Join-Path $root 'publish'
if (Test-Path $publish) { Remove-Item $publish -Recurse -Force }
dotnet publish .\src\OncaPDV.Desktop\OncaPDV.Desktop.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:DebugType=None -p:DebugSymbols=false -o $publish --no-restore
if ($LASTEXITCODE -ne 0) { throw 'Falha na publicacao.' }

$exe = Join-Path $publish 'OncaPDV.Desktop.exe'
if (-not (Test-Path $exe)) { throw "Executavel nao encontrado: $exe" }
$exeHash = (Get-FileHash $exe -Algorithm SHA256).Hash
Set-Content -LiteralPath "$exe.sha256" -Value "$exeHash  OncaPDV.Desktop.exe" -Encoding ascii

Write-Host '[5/5] Tentando gerar instalador Inno Setup...'
$iscc = @(
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles(x86)\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if ($iscc) {
    & $iscc .\installer\ONCA-PDV-PRO.iss
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao gerar instalador Inno Setup.' }
    $setup = Join-Path $root 'installer\Output\ONCA-PDV-PRO-Setup.exe'
    if (-not (Test-Path $setup)) { throw "Instalador nao encontrado: $setup" }
    $setupHash = (Get-FileHash $setup -Algorithm SHA256).Hash
    Set-Content -LiteralPath "$setup.sha256" -Value "$setupHash  ONCA-PDV-PRO-Setup.exe" -Encoding ascii
    Write-Host "INSTALADOR: $setup" -ForegroundColor Green
    Write-Host "SHA-256: $setupHash" -ForegroundColor Green
} else {
    Write-Warning 'Inno Setup 6 nao encontrado. O EXE foi publicado normalmente; instale o Inno Setup 6 e rode build-release.ps1 para gerar o instalador.'
}

Write-Host "EXE: $exe" -ForegroundColor Green
Write-Host "SHA-256 EXE: $exeHash" -ForegroundColor Green
Write-Host 'Nenhuma importacao real e nenhuma impressao fisica foram executadas por este script.' -ForegroundColor Yellow
