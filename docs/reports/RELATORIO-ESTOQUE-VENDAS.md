# Relatório — Ajustes de Estoque e Tela de Vendas

**Data:** 2026-08-08  
**Branch:** `cursor/onca-pdv-estoque-vendas-2c6b`  
**Versão do app:** 1.1.0 (sem bump — sem build de release nesta entrega)

## Alterações de Estoque

- Cadastro novo: **Estoque inicial** + **Estoque mínimo** (movimento `entry` com motivo `Estoque inicial`)
- Edição: painel claro **Estoque atual** vs **Estoque mínimo** + botão **Ajustar estoque**
- Modal unificado `StockAdjustModal`: Entrada / Saída / Definir quantidade + motivos pré-definidos + observação
- Mesmo modal em **Produtos > Editar** e **Estoque**
- Ajuste só para administrador (UI + `requireAdminSensitive` no backend)
- Nunca sobrescreve saldo sem `stock_movements` (`stock_before`, delta, motivo, usuário, data)

## Alterações de Vendas

- Cliente / busca / resultados à esquerda; carrinho / total / pagamentos à direita
- Flags **Sem estoque** / **Estoque baixo** com base em `min_stock_qty`
- Atalhos: F2 busca, F4 cliente, F8 histórico, F9 Item Diversos, F10 finalizar, ESC fecha modal
- Foco na busca após barcode e ao fechar modais
- Histórico recente oculto em altura baixa (F8 para histórico completo)
- Comprovante pós-venda: sucesso + Imprimir / WhatsApp / Nova venda
- Histórico: sem cancelamento/edição; Item Diversos preservado

## Arquivos alterados

- `web/src/modules/estoque/StockAdjustModal.tsx` (novo)
- `web/src/modules/estoque/EstoquePage.tsx`
- `web/src/modules/produtos/ProdutosPage.tsx`
- `web/src/modules/vendas/VendasPage.tsx`
- `web/src/modules/vendas/CustomerPicker.tsx`
- `web/src/modules/vendas/ReceiptModal.tsx`
- `web/src/styles/global.css`
- `server/src/services/productsService.js` (motivo estoque inicial)
- `server/src/estoqueVendas.test.js` (novo)
- `server/package.json`

## Migrations

Nenhuma. Reutiliza `stock_movements` / `stock_before` (014).

## Testes

| Checagem | Resultado |
|---|---|
| `npm test` | **93/93 PASS** |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm run e2e:etapa5` | **36/36 PASS** |
| SQLite `integrity_check` | ok |
| `foreign_key_check` | 0 |
| Vendas legacy `oncas_pdv_v2` | **87 preservadas** |
| Produtos reais | **496 preservados** |

## Regressões

Nenhuma falha crítica. Item Diversos e tipografia/botões preservados.

## Veredito

**AJUSTES DE ESTOQUE E TELA DE VENDAS CONCLUÍDOS E VALIDADOS — PRONTOS PARA BUILD DA PRÓXIMA VERSÃO.**
