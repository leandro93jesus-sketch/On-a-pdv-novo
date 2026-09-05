$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
dotnet build (Join-Path $projectRoot 'OncaPDV.slnx') -c Release --no-restore
dotnet test (Join-Path $projectRoot 'tests\OncaPDV.Tests\OncaPDV.Tests.csproj') -c Release --no-build --filter 'FullyQualifiedName~Upgrade|FullyQualifiedName~Smoke'
dotnet publish (Join-Path $projectRoot 'src\OncaPDV.Desktop\OncaPDV.Desktop.csproj') -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:DebugType=None -p:DebugSymbols=false -o (Join-Path $projectRoot 'publish')
$iscc = @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "$env:ProgramFiles(x86)\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw 'Inno Setup 6 não encontrado.' }
& $iscc (Join-Path $projectRoot 'installer\ONCA-PDV-PRO.iss')
$setup = Join-Path $projectRoot 'installer\Output\ONCA-PDV-PRO-Setup.exe'
$hash = (Get-FileHash $setup -Algorithm SHA256).Hash
Set-Content -LiteralPath "$setup.sha256" -Value "$hash  ONCA-PDV-PRO-Setup.exe" -Encoding ascii
Write-Host "Publicação e instalador prontos. SHA-256: $hash"
