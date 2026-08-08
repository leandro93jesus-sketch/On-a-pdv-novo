# Restauração — ONÇA PDV 1.0.0

## Aviso

Restaurar um backup **substitui** o banco atual da pasta de dados.
Faça um backup novo antes de restaurar.

## Procedimento recomendado (seguro)

1. Feche o ONÇA PDV.
2. Copie o arquivo atual `%APPDATA%\ONCA-PDV\onca-pdv.db` para um local seguro.
3. Abra o sistema e use o módulo **Backup** → restaurar, **ou**
4. Substitua manualmente `onca-pdv.db` pelo arquivo de backup desejado (com o app fechado).
5. Reabra o aplicativo e confira produtos, clientes e vendas.

## Validação após restaurar

No suporte técnico, validar:

- `PRAGMA integrity_check;` → `ok`
- `PRAGMA foreign_key_check;` → sem linhas

## Desinstalação

A desinstalação padrão **não** apaga automaticamente banco e backups em AppData.
Só remova a pasta de dados se tiver certeza e confirmação explícita.
