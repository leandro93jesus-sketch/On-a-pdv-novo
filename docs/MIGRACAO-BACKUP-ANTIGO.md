# Migração — Backup antigo em JSON (Oncas PDV v2)

Documento do **mapeamento REAL** do backup JSON do PDV antigo.

> Arquivo analisado (cópia): `oncas-pdv-backup-2026-08-07-1786145822438_eda5.json`  
> Tamanho: **223 981 bytes**  
> SHA-256: `6389a693b4f9f2f0d6c8b1781e633767db5e32913a26933d7c43212d0a112d70`  
> App legado: **Oncas PDV** · `backup.version = 2` · criado em `2026-08-07T23:37:02.422Z`  
> JSON válido: **sim** · Arquivo original: **não modificado** · Banco principal: **não alterado nesta etapa**

**IMPORTAÇÃO DEFINITIVA NÃO AUTORIZADA NESTA ETAPA.**  
Foi feita apenas **simulação em banco temporário**.

---

## 1. Estrutura raiz

| Chave | Tipo | Qtd / notas |
| --- | --- | --- |
| `products` | array | 488 |
| `customers` | array | 7 |
| `sales` | array | 87 (210 itens) |
| `stockMovements` | array | 204 |
| `cash` | object | `history`=2 sessões fechadas; `open`=true; `movements`=[] |
| `settings` | object | tema, receipt, printer, pix, etc. |
| `company` | object | razão, fantasia, CNPJ, endereço |
| `users` | array | 1 (admin + pinHash) |
| `auditLog` | array | 109 |
| `backup` / `backupHistory` / `backupSettings` | meta | histórico de backups do app antigo |
| `receivables` | array | **0** (sem crediário) |
| `payables` | array | 0 |
| `suppliers` | array | 0 |
| `purchases` | array | 0 |
| `deliveries` | array | 0 |
| `returns` | array | 0 |
| `quotes`, `salesGoals`, `promotions`, `financialEntries`, `internalNotes`, `operatorHistory` | array | 0 |
| `stockLocations` | array | 1 (`principal`) |
| `stockByLocation` | object | mapa por localização |
| `startDate` | string | `2026-08-01` |
| `_estoque1000feito` | flag | legado interno |

---

## 2. Inventário

| Coleção | Quantidade |
| --- | --- |
| Produtos | 488 |
| Clientes | 7 |
| Fornecedores | 0 |
| Vendas | 87 |
| Itens de venda | 210 |
| Crediário / receivables | 0 |
| Parcelas | 0 |
| Pagamentos de crediário | 0 |
| Compras | 0 |
| Movimentações de estoque | 204 |
| Entregas | 0 |
| Devoluções | 0 |
| Usuários | 1 |
| Auditoria | 109 |
| Sessões de caixa (history) | 2 |

---

## 3. Campos por coleção

### `products[]`
`id`, `code`, `name`, `category`, `price`, `cost`, `stock`, `min`, `active`, `_precoAnterior`  
(+ ocasionais: `createdAt`, `updatedAt`, `priceHistory`, `diverso`)

### `customers[]`
`id`, `name`, `phone`, `document`, `active`  
(+ ocasionais: `email`, `createdAt`, `updatedAt`)

### `sales[]`
`id`, `date`, `items[]`, `subtotal`, `discount`, `discountType`, `discountInput`, `total`, `payment`, `received`, `change`, `customer{}`, `operator{}`, `profit`, `_alertaOk`  
(+ ocasionais: `note`, `_obsOk`)

### `sales[].items[]`
Snapshot do produto + `qty` (+ `diverso`, timestamps)

### `stockMovements[]`
`id`, `date`, `productId`, `productName`, `productCode`, `before`, `after`, `difference`, `type`, `reason`, `reference`

### `cash`
`open`, `opening`, `openedAt`, `movements`, `history[]`, `valueHistory`, `sessions`

### `company`
`legalName`, `tradeName`, `cnpj`, `address`, `city`, `state`, `fiscal`

### `users[]`
`id`, `name`, `login`, `role`, `pinHash`, `active`, `permissions`, `mustChangePin`

---

## 4. Tabela de mapeamento (JSON → SQLite novo)

| Campo JSON antigo | Campo banco novo | Regra de conversão | Obrig./Opc. | Observação |
| --- | --- | --- | --- | --- |
| `products.id` | `products.legacy_id` | `String(id)` + `legacy_source=oncas_pdv_v2` | Obr. | Não vira PK |
| `products.code` (EAN 8–14) | `products.barcode` | só dígitos válidos; 1ª ocorrência | Opc. | Duplicados: 2º sem barcode |
| `products.code` (outros) | `products.sku` | sku canônico `L-{legacy_id}` | Obr. | Código interno não-EAN não vira barcode |
| `products.name` | `products.name` | trim | Obr. | |
| `products.category` | `products.category` | default `Geral` | Opc. | Categorias inconsistentes (LIMPEZA/limpeza/…) |
| `products.price` | `products.price_cents` | reais → `Math.round(x*100)` | Obr. | number em reais |
| `products.cost` | `products.cost_cents` | idem | Obr. | |
| `products.stock` | `products.stock_qty` | trunc int | Obr. | Snapshot atual |
| `products.min` | `products.min_stock_qty` | trunc ≥0 | Opc. | |
| `products.active` | `products.active` | false→0 else 1 | Opc. | |
| estoque &lt; 0 | `allow_negative_stock=1` | preserva valor negativo | — | 4 produtos |
| `customers.id` | `customers.legacy_id` | string | Obr. | id `0` = Consumidor Final |
| `customers.name` | `customers.name` | trim | Obr. | |
| `customers.document` | `customers.document` | só dígitos; `-`/`0`→null | Opc. | |
| `customers.phone` | `customers.phone` / `whatsapp` | limpa `-`/`0` | Opc. | |
| `customers.active` | `customers.active` | bool→0/1 | Opc. | |
| `sales.id` | `sales.legacy_id` | string | Obr. | |
| `sales.date` | `sales.created_at` | ISO mantida | Obr. | |
| `sales.subtotal/discount/total` | `*_cents` | reais→centavos | Obr. | |
| `sales.payment` | `sale_payments.method` | Dinheiro→dinheiro; PIX→pix; Cartão créd/déb→**cartao** | Obr. | Não é crediário |
| `sales.customer.id` | `sales.customer_id` | via legacy map | Opc. | |
| `sales.items[].qty/price` | `sale_items.quantity/unit_price_cents` | | Obr. | |
| item diverso / id&lt;0 / nome DIVERSO* | `sale_items.is_misc=1` | `product_id=null` | — | 62 itens diverso-like |
| `stockMovements.*` | `stock_movements` | histórico; **não reaplica** delta no estoque | Opc. | Estoque vem do snapshot |
| `cash.history[]` | `cash_sessions` (closed) | opening/expected/counted/difference → cents | Opc. | 2 sessões |
| `company.*` / `settings.receipt` | `settings` keys | store_name, document, address, receipt_message… | Opc. | |
| `users.pinHash` | — | **NÃO importar como senha** | — | Segurança |
| `receivables` | `credit_*` | vazio no backup | — | Nada a importar |
| `suppliers`/`purchases`/`deliveries`/`returns` | tabelas Etapa 3 | vazios | — | |

---

## 5. Análise financeira (backup)

| Indicador | Valor |
| --- | --- |
| Soma vendas (`sales.total`) | **R$ 3.430,53** (343 053 centavos) |
| Soma subtotais | R$ 3.437,53 |
| Soma descontos | R$ 7,00 |
| Crediário em aberto (`receivables`) | **R$ 0,00** (array vazio) |
| Valores pagos crediário | R$ 0,00 |
| Valores pendentes crediário | R$ 0,00 |
| Formas de pagamento | PIX 34 · Débito 25 · Dinheiro 20 · Crédito 8 |

> “Cartão de crédito” no JSON é **cartão**, não crediário/fiado.

---

## 6. Análise de estoque

| Indicador | Valor |
| --- | --- |
| Soma `stock` | 214 763 |
| Estoque zero | 12 |
| Estoque negativo | **4** (importados com `allow_negative_stock=1`) |
| Sem estoque informado | 0 |
| Códigos duplicados (barcode/code) | **38** pares (36 tratados no adaptador após filtros) |
| Códigos tipo URL/lixo | 2 |
| Parecem EAN | 440 |
| Códigos internos | 46 |

Produtos com estoque muito alto observados (ex.: 10 000 / 99 98 / 100 000) — **preservados** como estão no snapshot (não “corrigidos” silenciosamente).

---

## 7. Qualidade / inconsistências

- IDs de produto negativos em itens de venda (20) → tratados como **Item Diversos**
- Categorias com typos/duplicidade semântica (`LIMPEZA`/`limpeza`/`LIMPEZAS`, `ULTILITARIOS`/`UTILIDADES`…)
- Campos desconhecidos registrados: `product.priceHistory`, `product.code.junk`, `customer.email`, `sale.note`, `sale._obsOk`, etc.
- `users.pinHash` não reutilizado
- Sessão de caixa aberta no JSON (`cash.open=true`) — simulação importa só `history` fechado

---

## 8. Adaptador e simulação

| Peça | Caminho |
| --- | --- |
| Adaptador | `server/src/services/legacyImport/mapOncasPdvV2.js` |
| Simulação temp DB | `server/src/services/legacyImport/simulateOncasPdvV2.js` |
| CLI | `npm run simulate:oncas-v2 -- <arquivo.json>` |
| Relatório simulação | `docs/reports/SIMULACAO-IMPORT-ONCAS-PDV-V2.json` |
| Testes | `server/src/etapa4b.test.js` |

### Resultado da simulação (banco temporário)

| Métrica | JSON | DB temp | Match |
| --- | --- | --- | --- |
| Produtos | 488 | 488 | OK |
| Clientes | 7 | 7 | OK |
| Vendas | 87 | 87 | OK |
| Itens | 210 | 210 | OK |
| Total vendas | 343053¢ | 343053¢ | OK |
| Soma estoque | 214763 | 214763 | OK |
| integrity_check | — | ok | OK |
| Erros | — | 0 | OK |

**Nenhuma importação foi feita no banco principal.**

---

## 9. Estratégia de importação definitiva (quando autorizada)

1. Backup automático do SQLite atual (`pre_import`).
2. Usar adaptador `oncas_pdv_v2` (já selecionado automaticamente no parser se `matchesOncasPdvV2`).
3. Importar snapshot de produtos (estoque atual) **sem** reaplicar baixa pelas vendas.
4. Importar vendas/itens/pagamentos como histórico.
5. Importar `stockMovements` só como trilha (sem delta).
6. Importar `cash.history` como sessões fechadas.
7. Atualizar `settings` da empresa.
8. Validar integrity/FK/totais.
9. **Não** executar sem autorização explícita do responsável.

---

## 10. Histórico

- Etapa 3: tabelas alvo preparadas.
- Etapa 4: arquitetura genérica do importador.
- **Etapa 4B: mapeamento REAL Oncas PDV v2 + adaptador + simulação consistente.**
