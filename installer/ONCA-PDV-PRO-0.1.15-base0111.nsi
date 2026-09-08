Unicode true
Name "ONCA PDV PRO"
OutFile "ONCA-PDV-PRO-Setup-0.1.15-BASE-0111.exe"
InstallDir "$LOCALAPPDATA\Programs\ONCA-PDV-PRO"
RequestExecutionLevel user
SetCompressor /SOLID lzma

VIProductVersion "0.1.15.0"
VIAddVersionKey /LANG=1046 "ProductName" "ONCA PDV PRO"
VIAddVersionKey /LANG=1046 "CompanyName" "ONCA Produtos de Limpeza"
VIAddVersionKey /LANG=1046 "FileDescription" "ONCA PDV PRO 0.1.15 - visual 0.1.11 com botao receber visivel"
VIAddVersionKey /LANG=1046 "FileVersion" "0.1.15"

Page directory
Page instfiles

Section "ONCA PDV PRO" SEC01
  SetShellVarContext current
  nsExec::ExecToLog 'taskkill /F /IM OncaPDV.Desktop.exe'
  Sleep 700
  SetOutPath "$INSTDIR"
  File /r "publish-full\*.*"
  CreateDirectory "$SMPROGRAMS\ONCA PDV PRO"
  CreateShortcut "$SMPROGRAMS\ONCA PDV PRO\ONCA PDV PRO.lnk" "$INSTDIR\OncaPDV.Desktop.exe"
  CreateShortcut "$DESKTOP\ONCA PDV PRO.lnk" "$INSTDIR\OncaPDV.Desktop.exe"
  WriteUninstaller "$INSTDIR\Desinstalar-ONCA-PDV-PRO.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ONCA-PDV-PRO" "DisplayName" "ONCA PDV PRO"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ONCA-PDV-PRO" "DisplayVersion" "0.1.15"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ONCA-PDV-PRO" "Publisher" "ONCA Produtos de Limpeza"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ONCA-PDV-PRO" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ONCA-PDV-PRO" "UninstallString" '"$INSTDIR\Desinstalar-ONCA-PDV-PRO.exe"'
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
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ONCA-PDV-PRO"
SectionEnd
