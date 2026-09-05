[Setup]
AppId={{A4714C8A-931D-4E41-90E1-5F720E7129E7}
AppName=ONCA-PDV-PRO
AppVersion=0.1.4
AppPublisher=ONCA Produtos de Limpeza
DefaultDirName={autopf}\ONCA-PDV-PRO
OutputBaseFilename=ONCA-PDV-PRO-Setup
OutputDir=Output
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
PrivilegesRequired=admin
CloseApplications=yes
RestartApplications=no
UninstallDisplayIcon={app}\OncaPDV.Desktop.exe
[Files]
Source: "..\publish\*"; DestDir: "{app}"; Excludes: "appsettings.json"; Flags: recursesubdirs ignoreversion
Source: "..\publish\appsettings.json"; DestDir: "{app}"; Flags: onlyifdoesntexist uninsneveruninstall
[Icons]
Name: "{autoprograms}\ONÇA PDV"; Filename: "{app}\OncaPDV.Desktop.exe"
