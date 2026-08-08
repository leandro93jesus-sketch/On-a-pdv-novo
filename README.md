# ONÇA PDV

Sistema profissional de **Ponto de Venda** local-first.

- **Backend** (`server/`): Node.js + Express + SQLite (`better-sqlite3`)
- **Frontend** (`web/`): React + TypeScript + Vite
- **Etapa 1**: arquitetura, shell de navegação e módulo de **Vendas** completo
- **Etapa 2**: **Produtos**, **Estoque**, **Caixa** e **Clientes** (+ cancelamento pós-venda)

Documentação: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/DECISIONS.md](docs/DECISIONS.md)

## Requisitos

- Node.js >= 20
- npm (workspaces)

## Como executar

```bash
npm install
npm run dev
```

- API: http://localhost:3001  
- Web: http://localhost:5173 (proxy `/api` → API)

Scripts úteis:

| Comando | Descrição |
| --- | --- |
| `npm run dev` | API + Web |
| `npm test` | Testes automatizados do backend |
| `npm run lint` | ESLint do frontend |
| `npm run build` | Build de produção do frontend |
| `npm run migrate` | Lista/aplica migrations |
| `npm run seed` | Seed de catálogo (se vazio) |

## Módulo Vendas (etapa 1)

- Busca por nome/SKU/código
- Leitura por código de barras
- Carrinho com quantidade, desconto e Item Diversos
- Pagamentos: Dinheiro, Pix, Cartão (API pronta para múltiplos)
- Finalização com baixa de estoque e comprovante
- Histórico de vendas
- Bloqueio de estoque negativo (salvo regra explícita no produto)

## Variáveis de ambiente

| Variável | Descrição |
| --- | --- |
| `PORT` | Porta da API (padrão `3001`) |
| `PDV_DB_PATH` | Caminho do arquivo SQLite |
| `PDV_DATA_DIR` | Diretório de dados |
| `PDV_SEED` | `0` desliga seed automático |

## Estrutura

```
docs/                 arquitetura e decisões
server/src/           API, migrations, services
web/src/              UI, navegação, módulo Vendas
```
