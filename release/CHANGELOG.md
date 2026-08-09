# Changelog — ONÇA PDV

## 1.0.0 — 2026-08-08

### Estável inicial

- Módulos: Vendas, Caixa, Produtos, Estoque, Clientes, Fornecedores, Compras, Crediário, Devoluções, Entregas, Relatórios, Backup, Importação, Configurações, Usuários, Auditoria
- Item Diversos sem cadastro permanente / sem baixa de estoque de produto
- PDF comprovante (não fiscal) e compartilhamento WhatsApp (link; PDF anexado manualmente)
- Autenticação com hash scrypt; troca obrigatória da senha bootstrap
- Desktop Electron + instalador Windows (NSIS)
- Dados em AppData/ONCA-PDV (banco, backups, logs)
- Migração real Oncas PDV v2 validada (Etapas 4B/4C)
- Logs com rotação e redação de segredos
- Versão 1.0.0 visível na interface e health

### Limitações conhecidas

- WhatsApp não anexa PDF automaticamente
- Estoques negativos herdados do backup legado são preservados (não corrigidos silenciosamente)
- Crediário no backup real importado estava vazio
- Windows 7 não é suportado nesta linha
