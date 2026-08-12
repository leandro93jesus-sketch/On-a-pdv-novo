; ONÇA PDV — instalador NSIS (atualização segura)
; AppData/banco do usuário NÃO são apagados (deleteAppDataOnUninstall=false).

!macro customInstall
  DetailPrint "ONÇA PDV: atualizando arquivos do programa."
  DetailPrint "AppData/banco NÃO são removidos nem substituídos pelo instalador."
  DetailPrint "Banco típico: %APPDATA%\onca-pdv\ONCA-PDV\onca-pdv.db"
  DetailPrint "Legado: %APPDATA%\ONCA-PDV\onca-pdv.db"
  !ifndef BUILD_UNINSTALLER
    MessageBox MB_OK|MB_ICONINFORMATION \
      "ATUALIZAÇÃO DO ONÇA PDV$\n$\n\
Banco existente (se houver) será preservado em AppData.$\n\
Dados NÃO são apagados pelo instalador.$\n\
Na primeira abertura, um backup ONCA-PDV-PRE-ATUALIZACAO será criado$\n\
antes de aplicar migrations.$\n$\n\
Feche o ONÇA PDV antes de continuar, se ainda estiver aberto."
  !endif
!macroend

!macro customUnInstall
  DetailPrint "ONÇA PDV: desinstalando o programa. AppData/banco permanecem no computador."
!macroend
