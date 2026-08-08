export interface Product {
  id: number;
  name: string;
  price_cents: number;
  category: string;
}

export interface SaleItem {
  product_id: number;
  name: string;
  unit_price_cents: number;
  quantity: number;
}

export interface Sale {
  id: number;
  total_cents: number;
  payment_method: string;
  created_at: string;
  items?: SaleItem[];
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Erro ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchProducts(): Promise<Product[]> {
  return fetch('/api/products').then((r) => handle<Product[]>(r));
}

export function fetchSales(): Promise<Sale[]> {
  return fetch('/api/sales').then((r) => handle<Sale[]>(r));
}

export function createSale(payload: {
  items: { product_id: number; quantity: number }[];
  payment_method: string;
}): Promise<Sale> {
  return fetch('/api/sales', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle<Sale>(r));
}

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
