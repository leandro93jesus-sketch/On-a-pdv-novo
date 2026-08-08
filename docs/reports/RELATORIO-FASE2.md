# Relatório — Fase 2 (Duplicados + Estoque)

**Status:** implementada e validada (Linux/cloud).  
**Branch:** `cursor/onca-pdv-fase2-duplicados-estoque-2c6b`

## Entregas

1. Verificar duplicados (barcode, sku, nome exato/similar) — ações Não é duplicado / Revisar / Mesclar
2. Mesclagem segura com regra de estoque explícita, transaction, rollback e auditoria
3. Bloqueio barcode/sku; aviso de nome semelhante com confirmação
4. Ajustar estoque: Entrada / Saída / Definir saldo (sempre via movimentação)
5. Histórico do produto (movimentações, vendas, compras, devoluções)

## Migration

- `014_fase2_duplicates_stock.sql`

## Validação

- `npm test` 74/74 PASS (incl. Item Diversos)
- lint / build / review:fase2

## Item Diversos

Não alterado.
