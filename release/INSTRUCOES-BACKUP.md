# Backup — ONÇA PDV 1.0.0

## Onde ficam os backups

Windows:

`%APPDATA%\ONCA-PDV\backups\`

## Como criar

1. Abra o módulo **Backup** no sistema.
2. Clique em criar backup.
3. Confirme o arquivo `.db` e o manifesto gerados.

Recomendação: copie periodicamente a pasta `backups` para um pendrive ou outro disco.

## O que o backup contém

- Cópia do banco SQLite no momento da geração
- Metadados (versão do app, data/hora, hash quando aplicável)

## O que NÃO vai no instalador público

Backups reais do estabelecimento **não** são embutidos no `Setup.exe`.
