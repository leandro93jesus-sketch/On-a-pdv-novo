param([Parameter(Mandatory=$true)][string]$CertificateThumbprint,[string]$TimestampUrl='http://timestamp.digicert.com')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$signtool = Get-Command signtool.exe -ErrorAction Stop
$certificate = Get-ChildItem "Cert:\CurrentUser\My\$CertificateThumbprint" -ErrorAction Stop
if (-not $certificate.HasPrivateKey) { throw 'O certificado de code signing não possui chave privada.' }
$exe = Join-Path $root 'publish\OncaPDV.Desktop.exe'
$installer = Join-Path $root 'installer\Output\ONCA-PDV-PRO-Setup.exe'
foreach ($file in @($exe,$installer)) {
    if (-not (Test-Path $file)) { throw "Artefato não encontrado: $file" }
    & $signtool.Source sign /sha1 $CertificateThumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 $file
    if ($LASTEXITCODE -ne 0) { throw "Falha ao assinar: $file" }
    & $signtool.Source verify /pa /all $file
    if ($LASTEXITCODE -ne 0) { throw "Falha ao verificar assinatura: $file" }
}
Write-Host 'Executável e instalador assinados e verificados.'
