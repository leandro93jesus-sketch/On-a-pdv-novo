# Migração — Backup antigo em JSON

Documento vivo para a importação do **backup antigo em JSON** do ONÇA PDV.

> **IMPORTADOR PREPARADO — AGUARDANDO BACKUP JSON REAL PARA MAPEAMENTO FINAL.**
>
> O mapeamento definitivo **não** deve ser concluído sem analisar o arquivo de backup real. Nesta etapa existe arquitetura, leitor, validador, preview, mapeamento genérico (fixtures), importação transacional e testes.

## Arquitetura do importador

```
BACKUP JSON ANTIGO
  → LEITOR (parse UTF-8, tamanho, hash SHA-256)
  → VALIDADOR (JSON válido / vazio / estrutura)
  → ANÁLISE ESTRUTURAL (chaves, arrays, tipos, coleções heurísticas)
  → MODELO INTERMEDIÁRIO (mapGeneric — fixtures)
  → PRÉVIA (contagens, duplicidades, campos desconhecidos)
  → BACKUP AUTOMÁTICO DO SQLITE ATUAL
  → IMPORTAÇÃO EM TRANSACTION
  → VALIDAÇÃO FINAL (integrity_check, FKs, órfãos, estoque)
  → RELATÓRIO + HISTÓRICO (import_runs)
```

Código:

| Peça | Caminho |
| --- | --- |
| Análise | `server/src/services/legacyImport/analyze.js` |
| Mapeamento genérico | `server/src/services/legacyImport/mapGeneric.js` |
| Orquestração | `server/src/services/legacyImportService.js` |
| API | `POST /api/imports/preview`, `POST /api/imports/execute` |
| Fixtures de teste | `server/test/fixtures/legacy-json/` |

## Princípios

1. Migrations novas são sempre aditivas (nunca editar migrations antigas).
2. Dinheiro em centavos inteiros (`*_cents`) via `reaisToCents` / `parseLegacyMoneyToCents`.
3. Estoque inicial importado gera `stock_movements` (`entry`).
4. Registros financeiros/históricos não são apagados — preferir cancelamento/inativação.
5. IDs legados em `legacy_id` + `legacy_source` (não viram PK do banco novo).
6. Erro crítico → **ROLLBACK COMPLETO** da transaction de importação.
7. Campos desconhecidos **não** são descartados silenciosamente — entram no relatório.

## Tabelas alvo (Etapas 1–4)

| Módulo | Tabelas alvo | Campos-chave |
| --- | --- | --- |
| Produtos / Estoque | `products`, `stock_movements` | sku, barcode, price/cost cents, stock_qty, legacy_* |
| Clientes | `customers` | name, document, phone, whatsapp, legacy_* |
| Vendas | `sales`, `sale_items`, `sale_payments` | sale_number, customer_id, payments, legacy_* |
| Caixa | `cash_sessions`, `cash_movements` | opening/close, sangria/suprimento |
| Fornecedores | `suppliers` | name, document, address*, legacy_* |
| Compras | `purchases`, `purchase_items` | supplier_id, status, costs |
| Crediário | `credit_accounts`, `credit_installments`, `credit_payments` | balance, parcelas |
| Devoluções | `returns`, `return_items` | sale_id, quantity, reason |
| Entregas | `deliveries`, `delivery_history` | status, scheduled_date |
| Config / Auth | `settings`, `users`, `auth_sessions` | key/value, login hash |
| Backup / Import | `backup_history`, `import_runs` | sha256, reports |
| Auditoria | `audit_logs` | action, user_id, details JSON |

## Tratamento monetário

Aceita na prévia/importação genérica:

- `19.90` (number)
- `"19.90"`
- `"19,90"`
- `"R$ 19,90"`

Normalização → centavos inteiros. Não altera silenciosamente totais: valores inválidos geram registro em `invalid` / erro.

## Estratégia de duplicidade (genérico)

| Entidade | Chaves consideradas |
| --- | --- |
| Produtos | `legacy_id`, barcode, sku |
| Clientes | `legacy_id`, document, telefone+nome |
| Fornecedores | `legacy_id`, document, nome |
| Vendas | `legacy_id` + data + total |

Conflitos: **não sobrescreve**; incrementa `duplicated` / `ignored` no relatório.

## Estratégia de IDs antigos

- Colunas `legacy_id` + `legacy_source` em `products`, `customers`, `suppliers`, `sales`.
- PK novo continua `AUTOINCREMENT`.
- `legacy_source` do mapper genérico: `json_legado_generico`.

## Fluxo quando o JSON REAL for fornecido

1. Analisar primeiro (estrutura, encoding, IDs, datas, moeda) — **não importar imediatamente**.
2. Gerar relatório de estrutura (`analyzeJsonStructure`).
3. Atualizar esta documentação com mapeamento campo a campo.
4. Criar adaptador específico (além do `mapGeneric`).
5. Testar sobre uma **cópia** do banco.
6. Só então usar no banco definitivo.

## Limitações conhecidas (estado atual)

- Mapper genérico cobre fixtures/heurísticas (`produtos`, `clientes`, `fornecedores`, `vendas`…).
- Compras, crediário, devoluções e entregas legadas: detecção heurística de coleções existe; import completo aguarda schema real.
- Vendas importadas não reconstituem sessão de caixa nem parcelas de crediário automaticamente (pagamento `crediario` cai como `dinheiro` no genérico para não violar FKs).
- Backup real do usuário **ainda não foi analisado**.

## Endpoints

- `POST /api/imports/preview` — lê JSON, não grava dados de negócio (grava `import_runs` status=preview).
- `POST /api/imports/execute` — exige `confirm=true`; cria backup `pre_import`; transaction + relatório.
- `GET /api/imports` / `GET /api/imports/:id` — histórico.

## Histórico deste documento

- Etapa 3: tabelas alvo fornecedores/compras/crediário/devoluções/entregas.
- Etapa 4: arquitetura completa do importador, legacy_*, fixtures, API, testes; aguardando JSON real.
