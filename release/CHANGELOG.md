# Changelog — ONÇA PDV

## 1.2.17 — 2026-08-28

### Interface (não sobrecarregar a tela)

- Toast temporário após bipagem (produto + quantidade no carrinho)
- Aviso compacto de estoque zerado/insuficiente com Ajustar / Continuar / Agora não
- Cadastro rápido enxuto + “Mais informações”
- Produtos/Estoque: lista com Código, Produto, Preço, Estoque, Status, Ações
- Histórico: lista enxuta com Abrir; detalhes/PDF/alterar/excluir no detalhe
- Crediário: Receber (modal curto) e Abrir (detalhes)

### Crediário / Caixa

- Recebimento parcial lança valor no caixa (dinheiro/pix/cartão) e reduz `sales_crediario_cents`
- Novo tipo de movimento `recebimento_crediario` (migração 024)

### Qualidade

- Suite `validacaoFinalObrigatoria.test.js` com evidências dos cenários críticos

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
