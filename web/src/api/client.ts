export interface Product {
  id: number;
  sku: string | null;
  barcode: string | null;
  name: string;
  category: string;
  price_cents: number;
  cost_cents: number;
  stock_qty: number;
  allow_negative_stock: number;
  active: number;
}

export interface SaleItem {
  id: number;
  product_id: number | null;
  name: string;
  barcode: string | null;
  unit_price_cents: number;
  quantity: number;
  discount_cents: number;
  line_total_cents: number;
  is_misc: number;
}

export interface SalePayment {
  id: number;
  method: string;
  amount_cents: number;
  created_at: string;
}

export interface Sale {
  id: number;
  sale_number: string;
  status: string;
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  notes: string | null;
  created_at: string;
  cancelled_at: string | null;
  payment_method?: string | null;
  items?: SaleItem[];
  payments?: SalePayment[];
}

export interface CreateSalePayload {
  items: Array<{
    product_id?: number | null;
    name?: string;
    quantity: number;
    unit_price_cents?: number;
    discount_cents?: number;
    is_misc?: boolean;
  }>;
  discount_cents?: number;
  payment_method?: string;
  payments?: Array<{ method: string; amount_cents: number }>;
  notes?: string;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const err = new Error(body.error || `Erro ${res.status}`) as Error & {
      code?: string;
      details?: unknown;
    };
    err.code = body.code;
    err.details = body.details;
    throw err;
  }
  return res.json() as Promise<T>;
}

export function fetchProducts(params?: { q?: string; barcode?: string }): Promise<Product[]> {
  const qs = new URLSearchParams();
  if (params?.q) qs.set('q', params.q);
  if (params?.barcode) qs.set('barcode', params.barcode);
  const query = qs.toString();
  return fetch(`/api/products${query ? `?${query}` : ''}`).then((r) => handle<Product[]>(r));
}

export function fetchSales(limit = 50): Promise<Sale[]> {
  return fetch(`/api/sales?limit=${limit}`).then((r) => handle<Sale[]>(r));
}

export function fetchSale(id: number): Promise<Sale> {
  return fetch(`/api/sales/${id}`).then((r) => handle<Sale>(r));
}

export function createSale(payload: CreateSalePayload): Promise<Sale> {
  return fetch('/api/sales', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle<Sale>(r));
}

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function paymentLabel(method: string | null | undefined): string {
  switch (method) {
    case 'dinheiro':
      return 'Dinheiro';
    case 'pix':
      return 'Pix';
    case 'cartao':
      return 'Cartão';
    default:
      return method || '—';
  }
}
