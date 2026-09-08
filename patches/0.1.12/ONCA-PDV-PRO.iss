[Setup]
AppId={{A4714C8A-931D-4E41-90E1-5F720E7129E7}
AppName=ONCA-PDV-PRO
AppVersion=0.1.12
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

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  DataFile, BackupDir, BackupFile: String;
begin
  Result := '';
  DataFile := ExpandConstant('{localappdata}\Onca PDV Pro\data\onca-pdv-pro.db');
  if FileExists(DataFile) then
  begin
    BackupDir := ExpandConstant('{localappdata}\Onca PDV Pro\backups');
    ForceDirectories(BackupDir);
    BackupFile := BackupDir + '\pre-update-0.1.12-' + GetDateTimeString('yyyymmdd-hhnnss', '', '') + '.db';
    if not FileCopy(DataFile, BackupFile, False) then
      Result := 'Não foi possível criar o backup de segurança do banco atual. A atualização foi cancelada para proteger seus dados.';
  end;
end;
