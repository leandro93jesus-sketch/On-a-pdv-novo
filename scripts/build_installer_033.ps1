$ErrorActionPreference='Stop'
$root=(Resolve-Path '.').Path
$portable=Join-Path $root 'portable032'
$src=Join-Path $portable 'ONCA-PDV-PRO-0.1.32-AGUARDO-CANCELAR-ESTOQUE-TESTADO.exe'
if(-not (Test-Path $src)){throw "Portable EXE not found: $src"}

$iscc=(Get-Command ISCC.exe -ErrorAction SilentlyContinue).Source
if(-not $iscc){
  $candidates=@(
    'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
    'C:\Program Files\Inno Setup 6\ISCC.exe'
  )
  $iscc=$candidates | Where-Object {Test-Path $_} | Select-Object -First 1
}
if(-not $iscc){
  choco install innosetup --no-progress -y
  if($LASTEXITCODE -ne 0){throw "Chocolatey Inno Setup install failed: $LASTEXITCODE"}
  $iscc='C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
}
if(-not (Test-Path $iscc)){throw 'Inno Setup compiler not found'}

$out=(Resolve-Path $portable).Path
$iss=@"
[Setup]
AppId=ONCA-PDV-PRO
AppName=ONCA PDV PRO
AppVersion=0.1.33
AppPublisher=Onça Produtos de Limpeza
DefaultDirName={localappdata}\Programs\ONCA PDV PRO
DefaultGroupName=ONCA PDV PRO
DisableProgramGroupPage=yes
OutputDir=$out
OutputBaseFilename=ONCA-PDV-PRO-Setup-0.1.33
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
UninstallDisplayName=ONCA PDV PRO
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=no

[Files]
Source: "$src"; DestDir: "{app}"; DestName: "ONCA-PDV-PRO.exe"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\ONCA PDV PRO"; Filename: "{app}\ONCA-PDV-PRO.exe"
Name: "{autodesktop}\ONCA PDV PRO"; Filename: "{app}\ONCA-PDV-PRO.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na Área de Trabalho"; GroupDescription: "Atalhos:"; Flags: checkedonce

[Run]
Filename: "{app}\ONCA-PDV-PRO.exe"; Description: "Abrir ONCA PDV PRO"; Flags: nowait postinstall skipifsilent
"@

$issPath=Join-Path $portable 'onca-pdv.iss'
Set-Content -Path $issPath -Value $iss -Encoding UTF8
& $iscc $issPath
if($LASTEXITCODE -ne 0){throw "ISCC failed with code $LASTEXITCODE"}
$setup=Join-Path $portable 'ONCA-PDV-PRO-Setup-0.1.33.exe'
if(-not (Test-Path $setup)){throw 'Installer was not generated'}
Write-Host "Installer generated: $setup"
