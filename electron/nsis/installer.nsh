; ONÇA PDV — instalador NSIS (atualização segura)
; NÃO apaga AppData / banco do usuário (deleteAppDataOnUninstall=false no electron-builder).

!include "LogicLib.nsh"
!include "FileFunc.nsh"

Var /GLOBAL OncaExistingDb

!macro customInit
  StrCpy $OncaExistingDb "0"
  ; Caminhos persistentes (fora da pasta de instalação)
  ${If} ${FileExists} "$APPDATA\onca-pdv\ONCA-PDV\onca-pdv.db"
    StrCpy $OncaExistingDb "1"
  ${EndIf}
  ${If} ${FileExists} "$APPDATA\ONCA-PDV\onca-pdv.db"
    StrCpy $OncaExistingDb "1"
  ${EndIf}
  ${If} ${FileExists} "$APPDATA\onca-pdv\ONCA-PDV\configuracoes\impressoras.json"
    StrCpy $OncaExistingDb "1"
  ${EndIf}
  ${If} ${FileExists} "$APPDATA\ONCA-PDV\configuracoes\impressoras.json"
    StrCpy $OncaExistingDb "1"
  ${EndIf}
!macroend

!macro customWelcomePage
  ${If} $OncaExistingDb == "1"
    MessageBox MB_OK|MB_ICONINFORMATION \
      "ATUALIZAÇÃO DO ONÇA PDV$\n$\n\
Banco existente encontrado.$\n\
Dados serão preservados.$\n\
Backup de segurança será criado na primeira abertura da nova versão (antes das migrations).$\n$\n\
O instalador NÃO apaga nem substitui o banco em AppData.$\n$\n\
Clique em OK e depois em Atualizar/Instalar."
  ${Else}
    MessageBox MB_OK|MB_ICONINFORMATION \
      "INSTALAÇÃO DO ONÇA PDV$\n$\n\
Os dados ficam em pasta persistente do usuário (AppData),$\n\
não dentro da pasta do programa."
  ${EndIf}
!macroend

!macro customInstall
  DetailPrint "ONÇA PDV: pasta de instalação atualizada; AppData/banco NÃO são removidos."
  DetailPrint "Banco esperado: %APPDATA%\onca-pdv\ONCA-PDV\onca-pdv.db (ou %APPDATA%\ONCA-PDV\onca-pdv.db)"
!macroend
