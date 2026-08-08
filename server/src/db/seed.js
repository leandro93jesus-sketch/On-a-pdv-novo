import { getDb } from './index.js';

/**
 * Produtos de catálogo iniciais para desenvolvimento/demo local.
 * Não são "dados falsos de produção" — apenas bootstrap opcional do ambiente.
 * Em testes, fixtures próprias devem ser usadas.
 */
const DEMO_PRODUCTS = [
  {
    sku: 'BEB-001',
    barcode: '7891000100103',
    name: 'Água Mineral 500ml',
    category: 'Bebidas',
    price_cents: 350,
    cost_cents: 150,
    stock_qty: 100,
  },
  {
    sku: 'BEB-002',
    barcode: '7891000100110',
    name: 'Refrigerante Lata 350ml',
    category: 'Bebidas',
    price_cents: 550,
    cost_cents: 280,
    stock_qty: 80,
  },
  {
    sku: 'BEB-003',
    barcode: '7891000100127',
    name: 'Suco Natural 300ml',
    category: 'Bebidas',
    price_cents: 800,
    cost_cents: 400,
    stock_qty: 40,
  },
  {
    sku: 'ALI-001',
    barcode: '7891000200102',
    name: 'Pão Francês (un)',
    category: 'Padaria',
    price_cents: 100,
    cost_cents: 40,
    stock_qty: 200,
  },
  {
    sku: 'ALI-002',
    barcode: '7891000200119',
    name: 'Queijo Mussarela 100g',
    category: 'Frios',
    price_cents: 650,
    cost_cents: 380,
    stock_qty: 50,
  },
  {
    sku: 'ALI-003',
    barcode: '7891000200126',
    name: 'Presunto 100g',
    category: 'Frios',
    price_cents: 550,
    cost_cents: 300,
    stock_qty: 50,
  },
  {
    sku: 'LIM-001',
    barcode: '7891000300101',
    name: 'Detergente 500ml',
    category: 'Limpeza',
    price_cents: 390,
    cost_cents: 200,
    stock_qty: 60,
  },
  {
    sku: 'LIM-002',
    barcode: '7891000300118',
    name: 'Sabão em Pó 1kg',
    category: 'Limpeza',
    price_cents: 1290,
    cost_cents: 780,
    stock_qty: 35,
  },
  {
    sku: 'MER-001',
    barcode: '7891000400100',
    name: 'Arroz 5kg',
    category: 'Mercearia',
    price_cents: 2490,
    cost_cents: 1800,
    stock_qty: 25,
  },
  {
    sku: 'MER-002',
    barcode: '7891000400117',
    name: 'Feijão 1kg',
    category: 'Mercearia',
    price_cents: 890,
    cost_cents: 550,
    stock_qty: 40,
  },
  {
    sku: 'MER-003',
    barcode: '7891000400124',
    name: 'Café Torrado 500g',
    category: 'Mercearia',
    price_cents: 1890,
    cost_cents: 1200,
    stock_qty: 30,
  },
  {
    sku: 'DIV-001',
    barcode: '7891000500109',
    name: 'Caderno Universitário',
    category: 'Papelaria',
    price_cents: 1590,
    cost_cents: 900,
    stock_qty: 20,
  },
];

export function seedIfEmpty(db = getDb()) {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM products').get();
  if (count > 0) return { seeded: false, count };

  const insert = db.prepare(`
    INSERT INTO products (
      sku, barcode, name, category, price_cents, cost_cents, stock_qty, allow_negative_stock, active
    ) VALUES (
      @sku, @barcode, @name, @category, @price_cents, @cost_cents, @stock_qty, 0, 1
    )
  `);

  const tx = db.transaction((rows) => {
    for (const row of rows) insert.run(row);
  });
  tx(DEMO_PRODUCTS);

  return { seeded: true, count: DEMO_PRODUCTS.length };
}
