; ONÇA PDV — instalador NSIS (atualização segura + backup ao lado do Setup.exe)
; AppData/banco do usuário NÃO são apagados (deleteAppDataOnUninstall=false).
; Se existir onca-pdv-backup-*.db na MESMA PASTA do Setup.exe, copia para
; %APPDATA%\onca-pdv\ONCA-PDV\sidecar-from-installer\ para a 1ª abertura detectar.

!macro customInstall
  DetailPrint "ONÇA PDV: atualizando arquivos do programa."
  DetailPrint "AppData/banco NÃO são removidos nem substituídos pelo instalador."
  DetailPrint "Banco típico: %APPDATA%\onca-pdv\ONCA-PDV\onca-pdv.db"
  DetailPrint "Legado: %APPDATA%\ONCA-PDV\onca-pdv.db"

  ; Copia backups colocados ao lado do Setup.exe (pendrive) para AppData.
  ; A importação NÃO é automática — o app pede confirmação na primeira abertura.
  CreateDirectory "$APPDATA\onca-pdv\ONCA-PDV\sidecar-from-installer"
  DetailPrint "Procurando onca-pdv-backup-*.db em $EXEDIR"
  IfFileExists "$EXEDIR\onca-pdv-backup-*.db" 0 onca_no_sidecar_db
    DetailPrint "Backup encontrado ao lado do instalador — copiando para AppData (sidecar-from-installer)."
    CopyFiles /SILENT "$EXEDIR\onca-pdv-backup-*.db" "$APPDATA\onca-pdv\ONCA-PDV\sidecar-from-installer\"
    CopyFiles /SILENT "$EXEDIR\onca-pdv-backup-*.manifest.json" "$APPDATA\onca-pdv\ONCA-PDV\sidecar-from-installer\"
    FileOpen $R9 "$APPDATA\onca-pdv\ONCA-PDV\sidecar-from-installer\installer-exedir.txt" w
    FileWrite $R9 "$EXEDIR"
    FileClose $R9
    DetailPrint "Backup do pendrive/pasta copiado. Confirmação ocorrerá na 1ª abertura."
    Goto onca_after_sidecar
  onca_no_sidecar_db:
    DetailPrint "Nenhum onca-pdv-backup-*.db ao lado do Setup.exe."
  onca_after_sidecar:

  !ifndef BUILD_UNINSTALLER
    MessageBox MB_OK|MB_ICONINFORMATION \
      "ATUALIZAÇÃO / INSTALAÇÃO DO ONÇA PDV$\n$\n\
Banco existente (se houver) será preservado em AppData.$\n\
Dados NÃO são apagados pelo instalador.$\n$\n\
Se houver onca-pdv-backup-*.db na mesma pasta deste Setup.exe,$\n\
ele será detectado na primeira abertura para você confirmar.$\n$\n\
Feche o ONÇA PDV antes de continuar, se ainda estiver aberto."
  !endif
!macroend

!macro customUnInstall
  DetailPrint "ONÇA PDV: desinstalando o programa. AppData/banco permanecem no computador."
!macroend
