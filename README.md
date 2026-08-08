# On-a PDV (Ponto de Venda)

A simple full-stack **Point of Sale** starter application.

- **Backend** (`server/`): Node.js + Express + SQLite (`better-sqlite3`). Exposes a small REST API for products and sales. The database is embedded — no external service required.
- **Frontend** (`web/`): React + Vite + TypeScript. A touch-friendly POS screen: browse products by category, build a cart, choose a payment method, and finalize a sale. Recent sales are listed below.

## Requirements

- Node.js >= 20 (repo is developed with Node 22)
- npm (uses npm workspaces)

## Getting started

```bash
npm install        # installs both workspaces
npm run dev        # starts the API (:3001) and the web app (:5173) together
```

Then open http://localhost:5173. The Vite dev server proxies `/api` to the backend on port 3001.

### Run the pieces individually

```bash
npm run dev:server   # API only, http://localhost:3001
npm run dev:web      # web only, http://localhost:5173
```

## Useful commands

| Command | Description |
| --- | --- |
| `npm run dev` | Run backend + frontend together (dev mode) |
| `npm test` | Run backend API tests (Node's built-in test runner) |
| `npm run lint` | Lint the web app (ESLint) |
| `npm run build` | Type-check and build the web app for production |

## API overview

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Health check |
| `GET` | `/api/products` | List products (seeded on first run) |
| `POST` | `/api/products` | Create a product `{ name, price_cents, category }` |
| `GET` | `/api/sales` | List recent sales |
| `POST` | `/api/sales` | Create a sale `{ items: [{ product_id, quantity }], payment_method }` |
| `GET` | `/api/sales/:id` | Get a sale with its items |

Prices are stored as integer **cents** (`price_cents` / `total_cents`) to avoid floating-point rounding issues.

## Project layout

```
.
├── server/            # Express + SQLite API
│   └── src/
│       ├── db.js      # schema + seed data
│       ├── index.js   # routes
│       └── index.test.js
├── web/               # React + Vite frontend
│   └── src/
│       ├── App.tsx    # POS screen
│       └── api.ts     # typed API client
└── package.json       # npm workspaces + scripts
```
