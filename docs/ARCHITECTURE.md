# ONÇA PDV — Arquitetura do Sistema (Etapa 1)

## Visão geral

ONÇA PDV é um sistema de ponto de venda local-first, modular e preparado para distribuição em Windows no futuro. Nesta etapa o foco é a **fundação** (estrutura, banco, UI shell) e o módulo de **Vendas** totalmente funcional.

```
┌─────────────────┐     HTTP/JSON      ┌──────────────────┐
│  web/ (React)   │ ◄────────────────► │  server/ (Node)  │
│  Vite + TS      │   /api/*           │  Express         │
└─────────────────┘                    └────────┬─────────┘
                                                │
                                       ┌────────▼─────────┐
                                       │ SQLite (local)   │
                                       │ better-sqlite3   │
                                       └──────────────────┘
```

## Princípios

1. **Local-first**: banco SQLite embutido; sem dependência de serviço externo.
2. **Modular**: cada área de negócio (Vendas, Caixa, Estoque…) é um módulo de UI; o backend evolui por domínio (services/routes).
3. **Dinheiro em centavos**: valores monetários armazenados como `INTEGER` (centavos) para evitar erro de ponto flutuante.
4. **Transações atômicas**: venda + baixa de estoque + movimentos de estoque na mesma transação SQLite.
5. **Estoque seguro**: estoque negativo é bloqueado por padrão; só permitido se `allow_negative_stock = 1` no produto.
6. **Migrations versionadas**: schema evolui via arquivos SQL numerados, nunca “CREATE IF NOT EXISTS” ad hoc como única fonte da verdade.
7. **Preparação Windows**: layout de pastas e scripts pensados para empacotamento futuro (Electron/instalador); dados em diretório configurável (`PDV_DB_PATH` / `PDV_DATA_DIR`).

## Stack

| Camada | Tecnologia |
| --- | --- |
| Frontend | React 18 + TypeScript + Vite |
| Backend | Node.js (ESM) + Express |
| Banco | SQLite via `better-sqlite3` |
| Testes | Node.js test runner (`node:test`) |
| Workspaces | npm workspaces (`server`, `web`) |

## Estrutura de pastas

```
.
├── docs/                 # Documentação de arquitetura e decisões
├── server/
│   ├── data/             # SQLite em runtime (gitignored)
│   └── src/
│       ├── app.js        # Express app (exportável para testes)
│       ├── index.js      # Bootstrap HTTP
│       ├── db/           # conexão + migrator
│       ├── migrations/   # SQL versionado
│       ├── routes/       # HTTP handlers finos
│       ├── services/     # regras de negócio
│       ├── middleware/   # erros, validação
│       └── utils/
└── web/
    └── src/
        ├── api/          # cliente HTTP tipado
        ├── components/   # UI reutilizável
        ├── layouts/      # shell + navegação
        ├── modules/      # um diretório por área do PDV
        ├── styles/       # tokens CSS + tema
        └── utils/
```

## Módulos de UI (navegação)

| Módulo | Etapa 1 |
| --- | --- |
| Vendas | **Implementado** (Etapa 1 + vínculos Etapa 2) |
| Produtos, Estoque, Caixa, Clientes | **Implementado** (Etapa 2) |
| Fornecedores, Compras, Crediário, Devoluções, Entregas | **Implementado** (Etapa 3) |
| Relatórios, Backup/Restauração, Importador JSON, Configurações, Usuários, Auditoria, PDF, WhatsApp | **Implementado** (Etapa 4) |

## Domínio de Vendas

### Fluxo

1. Operador busca produto (nome/SKU) ou lê código de barras.
2. Itens entram no carrinho com quantidade editável.
3. Desconto (valor em R$) pode ser aplicado na venda.
4. “Item Diversos” permite lançar item avulso (sem produto/estoque).
5. Forma de pagamento: Dinheiro, Pix ou Cartão (schema preparado para múltiplos pagamentos).
6. Finalizar: valida estoque → grava venda + itens + pagamento → baixa estoque → gera comprovante.
7. Cancelar antes da conclusão: apenas limpa o carrinho local (nada persistido).

### Regras de estoque

- Produto catalogado: `stock_qty` decrementa pela quantidade vendida.
- Item Diversos: não mexe em estoque.
- Se `stock_qty - qty < 0` e `allow_negative_stock = 0` → erro `409` / `STOCK_INSUFFICIENT`.
- Toda alteração de estoque gera linha em `stock_movements` (auditoria).

### Pagamentos (evolução)

Tabela `sale_payments` já permite N métodos por venda. A UI da etapa 1 usa um método; a API aceita array `payments[]` para o futuro.

## API (etapa 1)

| Método | Path | Descrição |
| --- | --- | --- |
| GET | `/api/health` | Saúde do serviço |
| GET | `/api/products?q=&barcode=` | Busca produtos ativos |
| GET | `/api/products/:id` | Detalhe |
| POST | `/api/sales` | Finaliza venda |
| GET | `/api/sales` | Histórico |
| GET | `/api/sales/:id` | Venda + itens + pagamentos (comprovante) |

## Banco de dados

Migrations em `server/src/migrations/`. Tabela de controle: `schema_migrations`.

Tabelas principais da etapa 1:

- `products` — catálogo + estoque + barcode + flag de estoque negativo
- `sales` — cabeçalho (subtotal, desconto, total, status)
- `sale_items` — itens (inclui flag `is_misc` para Diversos)
- `sale_payments` — pagamentos da venda
- `stock_movements` — auditoria de estoque
- `settings` — configurações chave/valor

## Segurança e robustez (base)

- Validação de payloads no service layer.
- Foreign keys e CHECKs no SQLite.
- Erros HTTP tipados (`code` + `error`).
- Transações para consistência venda/estoque.
- Sem autenticação nesta etapa (previsto em Configurações / usuários).

## Empacotamento Windows (futuro)

- Backend e frontend empacotados juntos (ex.: Electron ou serviço local + UI).
- `PDV_DATA_DIR` apontando para `%APPDATA%/OncaPDV`.
- Scripts de build e instalador (NSIS/MSI) fora do escopo desta etapa; a estrutura já isola `data/` e usa variáveis de ambiente.

## Decisões importantes

1. **Centavos inteiros** em toda a stack (API e UI formatam só na apresentação).
2. **Migrations SQL** em vez de sync implícito de schema.
3. **Services** concentram regras; routes só fazem I/O HTTP.
4. **Placeholders** para módulos não implementados — navegação completa desde o dia 1.
5. **Seed opcional** via `PDV_SEED=1` ou banco vazio detectado em desenvolvimento — dados de demonstração não são a solução definitiva de negócio; testes usam fixtures próprias.
