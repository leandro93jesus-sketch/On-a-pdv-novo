# Arquitetura

- `Domain`: entidades, invariantes, pagamentos e segurança; não depende de UI ou banco.
- `Application`: casos de uso e contratos de persistência.
- `Infrastructure`: SQLite, migrations, transação de venda, recuperação e backup.
- `Printing`: contrato único, renderizadores ESC/POS 58/80 mm, mock e spooler RAW Win32.
- `Fiscal`: contrato isolado e mock restrito à homologação.
- `Migration`: inspeção SQLite estritamente read-only.
- `Desktop`: WPF Windows; não contém a transação de negócio.

A finalização usa uma transação única para venda, itens, pagamentos, estoque, caixa e crediário. Falha em qualquer etapa executa rollback.
