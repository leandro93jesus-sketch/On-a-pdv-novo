import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.PDV_DB_PATH || new URL('../data/pdv.db', import.meta.url).pathname;

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    category TEXT NOT NULL DEFAULT 'Geral',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    total_cents INTEGER NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'dinheiro',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    name TEXT NOT NULL,
    unit_price_cents INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0)
  );
`);

const SEED_PRODUCTS = [
  { name: 'Café Expresso', price_cents: 600, category: 'Bebidas' },
  { name: 'Cappuccino', price_cents: 900, category: 'Bebidas' },
  { name: 'Suco de Laranja', price_cents: 800, category: 'Bebidas' },
  { name: 'Água Mineral', price_cents: 400, category: 'Bebidas' },
  { name: 'Pão de Queijo', price_cents: 500, category: 'Salgados' },
  { name: 'Coxinha', price_cents: 700, category: 'Salgados' },
  { name: 'Sanduíche Natural', price_cents: 1200, category: 'Salgados' },
  { name: 'Bolo de Chocolate', price_cents: 1000, category: 'Doces' },
  { name: 'Brigadeiro', price_cents: 350, category: 'Doces' },
  { name: 'Sorvete', price_cents: 850, category: 'Doces' },
];

export function seedIfEmpty() {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM products').get();
  if (count > 0) return;
  const insert = db.prepare(
    'INSERT INTO products (name, price_cents, category) VALUES (@name, @price_cents, @category)'
  );
  const insertMany = db.transaction((rows) => {
    for (const row of rows) insert.run(row);
  });
  insertMany(SEED_PRODUCTS);
}
