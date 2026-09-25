$ErrorActionPreference='Stop'
$root=(Resolve-Path '.').Path
$x64=Join-Path $root 'legacy035x64\ONCA-PDV-PRO-x64.exe'
$x86=Join-Path $root 'legacy035x86\ONCA-PDV-PRO-x86.exe'
if(-not (Test-Path $x64)){throw "x64 EXE not found: $x64"}
if(-not (Test-Path $x86)){throw "x86 EXE not found: $x86"}

$iscc=(Get-Command ISCC.exe -ErrorAction SilentlyContinue).Source
if(-not $iscc){
  $candidates=@('C:\Program Files (x86)\Inno Setup 6\ISCC.exe','C:\Program Files\Inno Setup 6\ISCC.exe')
  $iscc=$candidates | Where-Object {Test-Path $_} | Select-Object -First 1
}
if(-not $iscc){
  choco install innosetup --no-progress -y
  if($LASTEXITCODE -ne 0){throw "Chocolatey Inno Setup install failed: $LASTEXITCODE"}
  $iscc='C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
}
if(-not (Test-Path $iscc)){throw 'Inno Setup compiler not found'}

$out=(Resolve-Path (Join-Path $root 'legacy035x64')).Path
$iss=@"
[Setup]
AppId=ONCA-PDV-PRO-LEGACY
AppName=ONCA PDV PRO
AppVersion=0.1.35
AppPublisher=Onça Produtos de Limpeza
DefaultDirName={localappdata}\Programs\ONCA PDV PRO
DefaultGroupName=ONCA PDV PRO
DisableProgramGroupPage=yes
OutputDir=$out
OutputBaseFilename=ONCA-PDV-PRO-Setup-0.1.35-COMPATIVEL
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
UninstallDisplayName=ONCA PDV PRO
CloseApplications=yes
RestartApplications=no
MinVersion=6.1sp1

[Files]
Source: "$x64"; DestDir: "{app}"; DestName: "ONCA-PDV-PRO.exe"; Flags: ignoreversion; Check: IsWin64
Source: "$x86"; DestDir: "{app}"; DestName: "ONCA-PDV-PRO.exe"; Flags: ignoreversion; Check: not IsWin64

[Icons]
Name: "{autoprograms}\ONCA PDV PRO"; Filename: "{app}\ONCA-PDV-PRO.exe"
Name: "{autodesktop}\ONCA PDV PRO"; Filename: "{app}\ONCA-PDV-PRO.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na Área de Trabalho"; GroupDescription: "Atalhos:"; Flags: checkedonce

[Run]
Filename: "{app}\ONCA-PDV-PRO.exe"; Description: "Abrir ONCA PDV PRO"; Flags: nowait postinstall skipifsilent
"@

$issPath=Join-Path $out 'onca-pdv-035-compat.iss'
Set-Content -Path $issPath -Value $iss -Encoding UTF8
& $iscc $issPath
if($LASTEXITCODE -ne 0){throw "ISCC failed with code $LASTEXITCODE"}
$setup=Join-Path $out 'ONCA-PDV-PRO-Setup-0.1.35-COMPATIVEL.exe'
if(-not (Test-Path $setup)){throw 'Installer was not generated'}
Write-Host "Installer generated: $setup"
