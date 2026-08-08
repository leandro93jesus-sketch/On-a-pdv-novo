# Migração — Backup antigo em JSON

Documento vivo para preparar a importação futura do **backup antigo em JSON** do ONÇA PDV.

> **Importante:** o mapeamento definitivo **não** deve ser implementado sem analisar o arquivo de backup real. Esta página registra o modelo alvo no SQLite atual e hipóteses de origem no JSON legado.

## Princípios

1. Migrations novas são sempre aditivas (nunca editar migrations antigas).
2. Dinheiro em centavos inteiros (`*_cents`).
3. Estoque só muda via `stock_movements` (nunca update solto).
4. Registros financeiros/históricos não são apagados — preferir cancelamento, estorno ou inativação.
5. Manter IDs legados (quando existirem) em campos auxiliares futuros (`legacy_id`, `legacy_ref`) se o JSON trouxer chaves estáveis.

## Tabelas já mapeáveis (Etapas 1–3)

| Módulo | Tabelas alvo | Campos-chave |
| --- | --- | --- |
| Produtos / Estoque | `products`, `stock_movements` | sku, barcode, price/cost cents, stock_qty |
| Clientes | `customers` | name, document, phone, address* |
| Vendas | `sales`, `sale_items`, `sale_payments` | sale_number, customer_id, payment methods |
| Caixa | `cash_sessions`, `cash_movements` | opening/close, sangria/suprimento |
| Fornecedores | `suppliers` | name, trade_name, document, address*, contact_name, active |
| Compras | `purchases`, `purchase_items` | supplier_id, status draft/completed/cancelled, costs |
| Crediário | `credit_accounts`, `credit_installments`, `credit_payments` | sale_id, customer_id, balance, parcelas, pagamentos |
| Devoluções | `returns`, `return_items` | sale_id, sale_item_id, quantity, reason |
| Entregas | `deliveries`, `delivery_history` | sale_id, status, scheduled_date, courier_name |
| Auditoria | `audit_logs` | action, entity_type, entity_id, details JSON |

## Hipóteses de origem no JSON antigo (a confirmar)

Não há schema definitivo ainda. Ao receber o backup real, localizar possíveis chaves/coleções:

| Possível origem no JSON | Destino sugerido | Observações |
| --- | --- | --- |
| `fornecedores` / `suppliers` | `suppliers` | Normalizar CPF/CNPJ só dígitos |
| `compras` / `entradas` | `purchases` + `purchase_items` | Converter valores para centavos; status |
| `crediario` / `contasReceber` | `credit_accounts` | Vincular cliente + venda quando possível |
| `parcelas` | `credit_installments` | Preservar vencimentos e saldos |
| `pagamentosCrediario` | `credit_payments` | Nunca sobrescrever — importar como histórico |
| `devolucoes` / `trocas` | `returns` + `return_items` | Validar qty ≤ vendida − já devolvida |
| `entregas` / `delivery` | `deliveries` + `delivery_history` | Mapear status legados → status atuais |
| históricos diversos | `audit_logs` / tabelas específicas | Preferir preservar trilha |

### Status canônicos atuais

- Compras: `draft` | `completed` | `cancelled`
- Crediário (conta/parcela): `aberto` | `parcialmente_pago` | `quitado` | `vencido` | `cancelado`
- Entregas: `pendente` | `separando` | `saiu_para_entrega` | `entregue` | `nao_entregue` | `cancelada`
- Pagamentos de venda: `dinheiro` | `pix` | `cartao` | `crediario`

## Plano de importação (futuro)

1. Analisar o JSON real (estrutura, encoding, IDs, datas, moeda).
2. Preencher tabela de mapeamento campo a campo nesta documentação.
3. Implementar importador idempotente com dry-run.
4. Gerar `stock_movements` e auditoria para cada efeito colateral.
5. Validar com testes de integridade SQLite (FKs, saldos, estoque).

## Pendências

- [ ] Receber e versionar amostra anonimizada do backup JSON antigo
- [ ] Confirmar nomes reais das coleções/campos
- [ ] Definir estratégia de `legacy_id` por entidade
- [ ] Implementar CLI/importador após Etapa de Backup

## Histórico deste documento

- Etapa 3: incluídos fornecedores, compras, crediário, devoluções, entregas e auditoria.
