# Instruções de instalação — ONÇA PDV 1.0.0

## Requisitos

- Windows 10 ou Windows 11 (64 bits)
- ~300 MB livres para o aplicativo
- Espaço adicional para banco, backups e logs

## Passos

1. Feche qualquer instância anterior do ONÇA PDV.
2. Execute o instalador `ONCA-PDV-Setup-1.0.0.exe`.
3. Aceite o local de instalação (ou altere se necessário).
4. Confirme a criação do atalho na área de trabalho.
5. Conclua e abra o aplicativo pelo atalho **ONÇA PDV**.

## Primeira execução

- O app cria `%APPDATA%\ONCA-PDV\` se ainda não existir.
- Migrations pendentes são aplicadas automaticamente.
- Se já existir um banco nessa pasta, ele é **preservado** (não sobrescrito).
- Faça login e troque a senha do administrador se solicitado.

## Atualizações futuras

Atualizações do aplicativo **não devem** substituir automaticamente:

- o banco SQLite
- backups
- configurações do usuário

Use sempre migrations versionadas.
