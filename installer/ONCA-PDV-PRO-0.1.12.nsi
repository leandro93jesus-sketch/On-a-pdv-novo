Unicode true
Name "ONCA PDV PRO"
OutFile "ONCA-PDV-PRO-Setup-0.1.12-NSIS.exe"
InstallDir "$LOCALAPPDATA\Programs\ONCA-PDV-PRO"
RequestExecutionLevel user
SetCompressor /SOLID lzma

VIProductVersion "0.1.12.0"
VIAddVersionKey /LANG=1046 "ProductName" "ONCA PDV PRO"
VIAddVersionKey /LANG=1046 "CompanyName" "ONCA Produtos de Limpeza"
VIAddVersionKey /LANG=1046 "FileDescription" "Instalador ONCA PDV PRO 0.1.12"
VIAddVersionKey /LANG=1046 "FileVersion" "0.1.12"

Page directory
Page instfiles

Section "ONCA PDV PRO" SEC01
  SetShellVarContext current

  ; Fecha a versão em uso, se houver
  nsExec::ExecToLog 'taskkill /F /IM OncaPDV.Desktop.exe'
  Sleep 700

  SetOutPath "$INSTDIR"

  ; Nunca toca na pasta de dados:
  ; $LOCALAPPDATA\Onca PDV Pro\data

  File "OncaPDV.Desktop.exe"

  CreateDirectory "$SMPROGRAMS\ONCA PDV PRO"
  CreateShortcut "$SMPROGRAMS\ONCA PDV PRO\ONCA PDV PRO.lnk" "$INSTDIR\OncaPDV.Desktop.exe"
  CreateShortcut "$DESKTOP\ONCA PDV PRO.lnk" "$INSTDIR\OncaPDV.Desktop.exe"

  WriteUninstaller "$INSTDIR\Desinstalar-ONCA-PDV-PRO.exe"

  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ONCA-PDV-PRO" "DisplayName" "ONCA PDV PRO"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ONCA-PDV-PRO" "DisplayVersion" "0.1.12"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ONCA-PDV-PRO" "Publisher" "ONCA Produtos de Limpeza"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ONCA-PDV-PRO" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ONCA-PDV-PRO" "UninstallString" '"$INSTDIR\Desinstalar-ONCA-PDV-PRO.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ONCA-PDV-PRO" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ONCA-PDV-PRO" "NoRepair" 1
SectionEnd

Section -Post
  IfSilent +2 0
  Exec "$INSTDIR\OncaPDV.Desktop.exe"
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  nsExec::ExecToLog 'taskkill /F /IM OncaPDV.Desktop.exe'

  Delete "$DESKTOP\ONCA PDV PRO.lnk"
  Delete "$SMPROGRAMS\ONCA PDV PRO\ONCA PDV PRO.lnk"
  RMDir "$SMPROGRAMS\ONCA PDV PRO"

  Delete "$INSTDIR\OncaPDV.Desktop.exe"
  Delete "$INSTDIR\Desinstalar-ONCA-PDV-PRO.exe"
  RMDir "$INSTDIR"

  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ONCA-PDV-PRO"

  ; Dados do usuário são preservados:
  ; $LOCALAPPDATA\Onca PDV Pro\data
SectionEnd
