# Banco de dados

SQLite local em `%LOCALAPPDATA%\Onca PDV Pro\data\onca-pdv-pro.db`, com `foreign_keys=ON`, WAL e `busy_timeout=5000`. `schema_versions` registra a migration inicial. Códigos internos e códigos de barras têm índices únicos; nomes podem repetir. Estoque só muda junto de `stock_movements`. Backup usa a API online do SQLite e só é aceito após `PRAGMA integrity_check=ok`.

Restauração destrutiva não foi exposta na interface: ela exigirá validação, backup do destino e confirmação explícita.
