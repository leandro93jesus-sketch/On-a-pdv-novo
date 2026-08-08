export interface Product {
  id: number;
  sku: string | null;
  barcode: string | null;
  name: string;
  category: string;
  unit?: string;
  price_cents: number;
  cost_cents: number;
  stock_qty: number;
  min_stock_qty?: number;
  allow_negative_stock: number;
  supplier_id?: number | null;
  supplier_name?: string | null;
  notes?: string | null;
  active: number;
  created_at?: string;
  updated_at?: string;
  situation?: string;
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
  client_request_id?: string | null;
  customer_id?: number | null;
  customer_name?: string | null;
  customer?: { id: number; name: string; document?: string | null; phone?: string | null } | null;
  cash_session_id?: number | null;
  created_at: string;
  cancelled_at: string | null;
  cancelled_by?: string | null;
  cancel_reason?: string | null;
  payment_method?: string | null;
  items?: SaleItem[];
  payments?: SalePayment[];
}

export interface Customer {
  id: number;
  name: string;
  document: string | null;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  address_number: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  notes: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface CashSession {
  id: number;
  terminal_id: string;
  operator_name: string;
  status: string;
  opening_amount_cents: number;
  opened_at: string;
  closed_at: string | null;
  sales_total_cents: number;
  sales_dinheiro_cents: number;
  sales_pix_cents: number;
  sales_cartao_cents: number;
  cash_in_cents: number;
  cash_out_cents: number;
  expected_amount_cents: number | null;
  counted_amount_cents: number | null;
  difference_cents: number | null;
  close_notes: string | null;
}

export interface StockRow {
  id: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  category: string;
  unit: string;
  stock_qty: number;
  min_stock_qty: number;
  situation: string;
  last_movement_at: string | null;
  last_movement_type: string | null;
}

export interface StockMovement {
  id: number;
  product_id: number;
  product_name: string;
  sku: string | null;
  barcode: string | null;
  movement_type: string;
  quantity_delta: number;
  stock_after: number;
  reason: string | null;
  user_name: string | null;
  reference_type: string | null;
  reference_id: number | null;
  created_at: string;
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
  client_request_id?: string;
  customer_id?: number | null;
  notes?: string;
  credit?: {
    entry_cents?: number;
    installment_count?: number;
    first_due_date?: string;
    notes?: string;
  };
}

export interface Supplier {
  id: number;
  name: string;
  trade_name: string | null;
  document: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  address_number: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  contact_name: string | null;
  notes: string | null;
  active: number;
  created_at?: string;
  updated_at?: string;
}

export interface Purchase {
  id: number;
  purchase_number: string;
  supplier_id: number;
  supplier_name?: string;
  status: string;
  subtotal_cents?: number;
  discount_cents?: number;
  freight_cents?: number;
  other_costs_cents?: number;
  total_cents: number;
  purchase_date: string;
  document_number?: string | null;
  notes?: string | null;
  items?: Array<{
    id: number;
    product_id: number;
    product_name: string;
    quantity: number;
    unit_cost_cents: number;
    discount_cents?: number;
    line_total_cents: number;
  }>;
}

export interface CreditAccount {
  id: number;
  customer_id: number;
  customer_name?: string;
  sale_id: number;
  sale_number?: string;
  total_cents: number;
  entry_cents: number;
  balance_cents: number;
  installment_count: number;
  status: string;
  installments?: Array<{
    id: number;
    installment_number: number;
    due_date: string;
    amount_cents: number;
    paid_cents: number;
    status: string;
  }>;
  payments?: Array<{
    id: number;
    amount_cents: number;
    method: string;
    paid_at: string;
    is_reversal: number;
  }>;
}

export interface ReturnRecord {
  id: number;
  return_number: string;
  sale_id: number;
  sale_number?: string;
  reason: string;
  total_cents: number;
  user_name?: string | null;
  created_at: string;
  items?: Array<{
    id: number;
    sale_item_id: number;
    product_id: number | null;
    product_name: string;
    quantity: number;
    unit_price_cents: number;
    line_total_cents: number;
  }>;
}

export interface Delivery {
  id: number;
  sale_id: number;
  sale_number?: string;
  customer_id?: number | null;
  customer_name: string | null;
  phone: string | null;
  whatsapp?: string | null;
  address?: string | null;
  address_number?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  scheduled_date: string | null;
  period: string | null;
  notes?: string | null;
  courier_name: string | null;
  status: string;
  history?: Array<{
    id: number;
    from_status: string | null;
    to_status: string;
    note: string | null;
    user_name?: string | null;
    created_at: string;
  }>;
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

function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function fetchProducts(params?: {
  q?: string;
  barcode?: string;
  include_inactive?: boolean;
}): Promise<Product[]> {
  return fetch(
    `/api/products${qs({
      q: params?.q,
      barcode: params?.barcode,
      include_inactive: params?.include_inactive ? '1' : undefined,
    })}`
  ).then((r) => handle<Product[]>(r));
}

export function createProduct(payload: Record<string, unknown>): Promise<Product> {
  return fetch('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle<Product>(r));
}

export function updateProduct(id: number, payload: Record<string, unknown>): Promise<Product> {
  return fetch(`/api/products/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle<Product>(r));
}

export function deleteProduct(id: number): Promise<{ deleted?: boolean; inactivated?: boolean }> {
  return fetch(`/api/products/${id}`, { method: 'DELETE' }).then((r) =>
    handle<{ deleted?: boolean; inactivated?: boolean }>(r)
  );
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

export function cancelSale(
  id: number,
  payload: { reason: string; user_name?: string }
): Promise<Sale> {
  return fetch(`/api/sales/${id}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle<Sale>(r));
}

export function fetchCustomers(params?: { q?: string; include_inactive?: boolean }): Promise<Customer[]> {
  return fetch(
    `/api/customers${qs({
      q: params?.q,
      include_inactive: params?.include_inactive ? '1' : undefined,
    })}`
  ).then((r) => handle<Customer[]>(r));
}

export function createCustomer(payload: Record<string, unknown>): Promise<Customer> {
  return fetch('/api/customers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle<Customer>(r));
}

export function updateCustomer(id: number, payload: Record<string, unknown>): Promise<Customer> {
  return fetch(`/api/customers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle<Customer>(r));
}

export function inactivateCustomer(id: number): Promise<Customer> {
  return fetch(`/api/customers/${id}/inactivate`, { method: 'POST' }).then((r) =>
    handle<Customer>(r)
  );
}

export function fetchCustomerPurchases(id: number): Promise<Sale[]> {
  return fetch(`/api/customers/${id}/purchases`).then((r) => handle<Sale[]>(r));
}

export function fetchStock(params?: { q?: string; alerts?: boolean }): Promise<StockRow[]> {
  return fetch(
    `/api/stock${qs({ q: params?.q, alerts: params?.alerts ? '1' : undefined })}`
  ).then((r) => handle<StockRow[]>(r));
}

export function fetchStockMovements(params?: {
  product_id?: number;
  limit?: number;
}): Promise<StockMovement[]> {
  return fetch(
    `/api/stock/movements${qs({ product_id: params?.product_id, limit: params?.limit })}`
  ).then((r) => handle<StockMovement[]>(r));
}

export function createStockMovement(payload: Record<string, unknown>): Promise<{
  stock_after: number;
  movement_type: string;
}> {
  return fetch('/api/stock/movements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle(r));
}

export function fetchOpenCash(): Promise<CashSession | null> {
  return fetch('/api/cash/sessions/current').then((r) => handle<CashSession | null>(r));
}

export function fetchCashSessions(limit = 50): Promise<CashSession[]> {
  return fetch(`/api/cash/sessions?limit=${limit}`).then((r) => handle<CashSession[]>(r));
}

export function openCash(payload: {
  operator_name: string;
  opening_amount_cents: number;
  terminal_id?: string;
}): Promise<CashSession> {
  return fetch('/api/cash/sessions/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle<CashSession>(r));
}

export function closeCash(payload: {
  counted_amount_cents: number;
  close_notes?: string;
}): Promise<{ session: CashSession; expected_amount_cents: number; breakdown: Record<string, number> }> {
  return fetch('/api/cash/sessions/close', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle(r));
}

export function cashMovement(payload: {
  movement_type: string;
  amount_cents: number;
  reason: string;
}): Promise<CashSession> {
  return fetch('/api/cash/movements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle<CashSession>(r));
}

export function fetchCashConference(id: number): Promise<{
  session: CashSession;
  expected_amount_cents: number;
  breakdown: Record<string, number>;
}> {
  return fetch(`/api/cash/sessions/${id}`).then((r) => handle(r));
}

export function fetchCashMovements(sessionId: number): Promise<
  Array<{
    id: number;
    movement_type: string;
    amount_cents: number;
    payment_method: string | null;
    reason: string | null;
    user_name: string | null;
    created_at: string;
  }>
> {
  return fetch(`/api/cash/sessions/${sessionId}/movements`).then((r) => handle(r));
}

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function parseBRLToCents(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return 0;
  if (trimmed.includes('-')) return null;
  const normalized = trimmed.replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function paymentLabel(method: string | null | undefined): string {
  switch (method) {
    case 'dinheiro':
      return 'Dinheiro';
    case 'pix':
      return 'Pix';
    case 'cartao':
      return 'Cartão';
    case 'crediario':
      return 'Crediário';
    case 'misto':
      return 'Misto';
    default:
      return method || '—';
  }
}

export function fetchSuppliers(params?: { q?: string; include_inactive?: boolean }): Promise<Supplier[]> {
  return fetch(
    `/api/suppliers${qs({
      q: params?.q,
      include_inactive: params?.include_inactive ? '1' : undefined,
    })}`
  ).then((r) => handle<Supplier[]>(r));
}

export function createSupplier(payload: Record<string, unknown>): Promise<Supplier> {
  return fetch('/api/suppliers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle<Supplier>(r));
}

export function updateSupplier(id: number, payload: Record<string, unknown>): Promise<Supplier> {
  return fetch(`/api/suppliers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle<Supplier>(r));
}

export function inactivateSupplier(id: number): Promise<Supplier> {
  return fetch(`/api/suppliers/${id}/inactivate`, { method: 'POST' }).then((r) => handle<Supplier>(r));
}

export function fetchSupplierPurchases(id: number): Promise<Purchase[]> {
  return fetch(`/api/suppliers/${id}/purchases`).then((r) => handle<Purchase[]>(r));
}

export function fetchPurchases(params?: {
  status?: string;
  supplier_id?: number;
}): Promise<Purchase[]> {
  return fetch(
    `/api/purchases${qs({ status: params?.status, supplier_id: params?.supplier_id })}`
  ).then((r) => handle<Purchase[]>(r));
}

export function fetchPurchase(id: number): Promise<Purchase> {
  return fetch(`/api/purchases/${id}`).then((r) => handle<Purchase>(r));
}

export function createPurchase(payload: Record<string, unknown>): Promise<Purchase> {
  return fetch('/api/purchases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle<Purchase>(r));
}

export function completePurchase(id: number): Promise<Purchase> {
  return fetch(`/api/purchases/${id}/complete`, { method: 'POST' }).then((r) =>
    handle<Purchase>(r)
  );
}

export function cancelPurchase(id: number, reason: string): Promise<Purchase> {
  return fetch(`/api/purchases/${id}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  }).then((r) => handle<Purchase>(r));
}

export function fetchCreditSummary(): Promise<{
  total_open_cents: number;
  total_overdue_cents: number;
  total_received_cents: number;
  customers_with_balance: number;
}> {
  return fetch('/api/credit/summary').then((r) => handle(r));
}

export function fetchCreditAccounts(params?: {
  status?: string;
  customer_id?: number;
}): Promise<CreditAccount[]> {
  return fetch(
    `/api/credit/accounts${qs({ status: params?.status, customer_id: params?.customer_id })}`
  ).then((r) => handle<CreditAccount[]>(r));
}

export function fetchCreditAccount(id: number): Promise<CreditAccount> {
  return fetch(`/api/credit/accounts/${id}`).then((r) => handle<CreditAccount>(r));
}

export function payCredit(payload: {
  credit_account_id: number;
  amount_cents: number;
  method: string;
}): Promise<CreditAccount> {
  return fetch('/api/credit/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle<CreditAccount>(r));
}

export function fetchReturns(): Promise<ReturnRecord[]> {
  return fetch('/api/returns').then((r) => handle<ReturnRecord[]>(r));
}

export function fetchReturn(id: number): Promise<ReturnRecord> {
  return fetch(`/api/returns/${id}`).then((r) => handle<ReturnRecord>(r));
}

export function createReturn(payload: Record<string, unknown>): Promise<ReturnRecord> {
  return fetch('/api/returns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle<ReturnRecord>(r));
}

export function fetchDeliveries(params?: {
  status?: string;
  customer_id?: number;
  courier?: string;
  date_from?: string;
  date_to?: string;
}): Promise<Delivery[]> {
  return fetch(
    `/api/deliveries${qs({
      status: params?.status,
      customer_id: params?.customer_id,
      courier: params?.courier,
      date_from: params?.date_from,
      date_to: params?.date_to,
    })}`
  ).then((r) => handle<Delivery[]>(r));
}

export function createDelivery(payload: Record<string, unknown>): Promise<Delivery> {
  return fetch('/api/deliveries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle<Delivery>(r));
}

export function updateDeliveryStatus(
  id: number,
  payload: { status: string; note?: string; courier_name?: string }
): Promise<Delivery> {
  return fetch(`/api/deliveries/${id}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle<Delivery>(r));
}

export function fetchDelivery(id: number): Promise<Delivery> {
  return fetch(`/api/deliveries/${id}`).then((r) => handle<Delivery>(r));
}
