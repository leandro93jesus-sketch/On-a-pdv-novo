import express from 'express';
import cors from 'cors';
import { db, seedIfEmpty } from './db.js';

seedIfEmpty();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'on-a-pdv-server', time: new Date().toISOString() });
});

app.get('/api/products', (_req, res) => {
  const products = db
    .prepare('SELECT id, name, price_cents, category FROM products ORDER BY category, name')
    .all();
  res.json(products);
});

app.post('/api/products', (req, res) => {
  const { name, price_cents, category } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name é obrigatório' });
  }
  if (!Number.isInteger(price_cents) || price_cents < 0) {
    return res.status(400).json({ error: 'price_cents deve ser um inteiro >= 0' });
  }
  const info = db
    .prepare('INSERT INTO products (name, price_cents, category) VALUES (?, ?, ?)')
    .run(name.trim(), price_cents, (category || 'Geral').trim());
  const product = db
    .prepare('SELECT id, name, price_cents, category FROM products WHERE id = ?')
    .get(info.lastInsertRowid);
  res.status(201).json(product);
});

app.post('/api/sales', (req, res) => {
  const { items, payment_method } = req.body ?? {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items não pode ser vazio' });
  }

  const getProduct = db.prepare('SELECT id, name, price_cents FROM products WHERE id = ?');
  const resolved = [];
  for (const item of items) {
    const product = getProduct.get(item.product_id);
    if (!product) {
      return res.status(400).json({ error: `produto ${item.product_id} não encontrado` });
    }
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ error: `quantidade inválida para ${product.name}` });
    }
    resolved.push({ product, quantity });
  }

  const total_cents = resolved.reduce((sum, r) => sum + r.product.price_cents * r.quantity, 0);
  const method = typeof payment_method === 'string' && payment_method.trim() ? payment_method.trim() : 'dinheiro';

  const createSale = db.transaction(() => {
    const saleInfo = db
      .prepare('INSERT INTO sales (total_cents, payment_method) VALUES (?, ?)')
      .run(total_cents, method);
    const saleId = saleInfo.lastInsertRowid;
    const insertItem = db.prepare(
      'INSERT INTO sale_items (sale_id, product_id, name, unit_price_cents, quantity) VALUES (?, ?, ?, ?, ?)'
    );
    for (const r of resolved) {
      insertItem.run(saleId, r.product.id, r.product.name, r.product.price_cents, r.quantity);
    }
    return saleId;
  });

  const saleId = createSale();
  const sale = getSaleById(saleId);
  res.status(201).json(sale);
});

app.get('/api/sales', (_req, res) => {
  const sales = db
    .prepare('SELECT id, total_cents, payment_method, created_at FROM sales ORDER BY id DESC LIMIT 50')
    .all();
  res.json(sales);
});

app.get('/api/sales/:id', (req, res) => {
  const sale = getSaleById(Number(req.params.id));
  if (!sale) return res.status(404).json({ error: 'venda não encontrada' });
  res.json(sale);
});

function getSaleById(id) {
  const sale = db
    .prepare('SELECT id, total_cents, payment_method, created_at FROM sales WHERE id = ?')
    .get(id);
  if (!sale) return null;
  sale.items = db
    .prepare('SELECT product_id, name, unit_price_cents, quantity FROM sale_items WHERE sale_id = ?')
    .all(id);
  return sale;
}

const PORT = Number(process.env.PORT || 3001);

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[on-a-pdv] servidor rodando em http://localhost:${PORT}`);
  });
}

export { app, getSaleById };
