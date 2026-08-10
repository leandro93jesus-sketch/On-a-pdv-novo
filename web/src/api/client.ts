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
  customer?: {
    id: number;
    name: string;
    document?: string | null;
    phone?: string | null;
    whatsapp?: string | null;
  } | null;
  cash_session_id?: number | null;
  created_at: string;
  cancelled_at: string | null;
  cancelled_by?: string | null;
  cancel_reason?: string | null;
  payment_method?: string | null;
  amount_received_cents?: number;
  change_cents?: number;
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
  sales_crediario_cents?: number;
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
  stock_before?: number | null;
  stock_after: number;
  reason: string | null;
  user_name: string | null;
  reference_type: string | null;
  reference_id: number | null;
  note?: string | null;
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
  amount_received_cents?: number;
  change_cents?: number;
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

const AUTH_KEY = 'onca_auth';

export interface AuthUser {
  id: number;
  name: string;
  login: string;
  role: string;
  active?: number;
  must_change_password?: number;
  last_login_at?: string | null;
}

export interface AuthSession {
  token: string;
  user: AuthUser;
  expires_at?: string;
}

export function getStoredAuth(): AuthSession | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed?.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getAuthToken(): string | null {
  return getStoredAuth()?.token ?? null;
}

export function getStoredAuthUser(): AuthUser | null {
  return getStoredAuth()?.user ?? null;
}

export function setAuthToken(token: string | null, user?: AuthUser | null): void {
  if (!token) {
    localStorage.removeItem(AUTH_KEY);
    return;
  }
  const prev = getStoredAuth();
  const next: AuthSession = {
    token,
    user: user ?? prev?.user ?? { id: 0, name: '', login: '', role: '' },
    expires_at: prev?.expires_at,
  };
  localStorage.setItem(AUTH_KEY, JSON.stringify(next));
}

export function setAuthSession(session: AuthSession): void {
  localStorage.setItem(AUTH_KEY, JSON.stringify(session));
}

export function clearAuth(): void {
  localStorage.removeItem(AUTH_KEY);
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
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return undefined as T;
  return res.json() as Promise<T>;
}

function authHeaders(extra?: HeadersInit): HeadersInit {
  const headers: Record<string, string> = {};
  if (extra) {
    if (extra instanceof Headers) {
      extra.forEach((v, k) => {
        headers[k] = v;
      });
    } else if (Array.isArray(extra)) {
      for (const [k, v] of extra) headers[k] = v;
    } else {
      Object.assign(headers, extra);
    }
  }
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** Fetch wrapper that attaches Bearer token when present. */
export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, {
    ...init,
    headers: authHeaders(init.headers),
  });
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
  return apiFetch('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle<Product>(r));
}

export function updateProduct(id: number, payload: Record<string, unknown>): Promise<Product> {
  return apiFetch(`/api/products/${id}`, {
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

export function fetchSales(
  limitOrParams: number | {
    limit?: number;
    q?: string;
    from?: string;
    to?: string;
    period?: string;
    payment_method?: string;
    status?: string;
  } = 50
): Promise<Sale[]> {
  const params =
    typeof limitOrParams === 'number'
      ? { limit: limitOrParams }
      : {
          limit: limitOrParams.limit ?? 50,
          q: limitOrParams.q,
          from: limitOrParams.from,
          to: limitOrParams.to,
          period: limitOrParams.period,
          payment_method: limitOrParams.payment_method,
          status: limitOrParams.status,
        };
  return apiFetch(`/api/sales${qs(params)}`).then((r) => handle<Sale[]>(r));
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
  stock_before?: number;
  quantity_delta?: number;
  movement_type: string;
}> {
  return apiFetch('/api/stock/movements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle(r));
}

export function setStockBalanceApi(payload: {
  product_id: number;
  new_qty: number;
  reason: string;
  note?: string;
}): Promise<{
  stock_before: number;
  stock_after: number;
  quantity_delta: number;
  operation: string;
}> {
  return apiFetch('/api/stock/set-balance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle(r));
}

export interface ProductHistory {
  product: Product;
  movements: Array<StockMovement & { stock_before?: number; reason?: string; user_name?: string }>;
  sales: Array<Record<string, unknown>>;
  purchases: Array<Record<string, unknown>>;
  returns: Array<Record<string, unknown>>;
  summary: Record<string, number>;
}

export function fetchProductHistory(productId: number, limit = 200): Promise<ProductHistory> {
  return apiFetch(`/api/products/${productId}/history${qs({ limit })}`).then((r) =>
    handle<ProductHistory>(r)
  );
}

export interface DuplicateCandidate {
  product_a_id: number;
  product_b_id: number;
  match_type: string;
  score: number;
  status: string;
  label: string;
  product_a: Product & { sales_count?: number };
  product_b: Product & { sales_count?: number };
}

export function fetchDuplicateProducts(includeInactive = false): Promise<{
  totals: Record<string, unknown>;
  candidates: DuplicateCandidate[];
}> {
  return apiFetch(
    `/api/products/duplicates${qs({ include_inactive: includeInactive ? '1' : undefined })}`
  ).then((r) => handle(r));
}

export function reviewDuplicateApi(payload: {
  product_a_id: number;
  product_b_id: number;
  match_type: string;
  status: 'pending' | 'not_duplicate' | 'review' | 'merged';
  notes?: string;
}): Promise<Record<string, unknown>> {
  return apiFetch('/api/products/duplicates/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle(r));
}

export function previewMergeApi(primaryId: number, secondaryId: number): Promise<{
  primary: Record<string, unknown>;
  secondary: Record<string, unknown>;
  stock_rules: { sum: number; keep_primary: number; keep_secondary: number };
}> {
  return apiFetch(
    `/api/products/merge/preview${qs({ primary_id: primaryId, secondary_id: secondaryId })}`
  ).then((r) => handle(r));
}

export function mergeProductsApi(payload: {
  primary_id: number;
  secondary_id: number;
  stock_rule: 'sum' | 'keep_primary' | 'keep_secondary';
  confirm: boolean;
}): Promise<Record<string, unknown>> {
  return apiFetch('/api/products/merge', {
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

export function fetchSupportDiagnostics(): Promise<Record<string, unknown>> {
  return apiFetch('/api/support/diagnostics').then((r) => handle(r));
}

export function generateDiagnosticReportApi(): Promise<Record<string, unknown>> {
  return apiFetch('/api/support/diagnostic-report', { method: 'POST' }).then((r) => handle(r));
}

export function exportDatasetApi(dataset: string): Promise<{
  filename: string;
  content: string;
  rows: number;
  mime: string;
}> {
  return apiFetch(`/api/export/${dataset}`, { method: 'POST' }).then((r) => handle(r));
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

/* ─── Etapa 4: Auth, Settings, Users, Reports, Backup, Import, Audit ─── */

export interface LogoMeta {
  has_logo: boolean;
  filename?: string | null;
  mime?: string | null;
  url?: string | null;
}

export interface PrinterSettings {
  use_windows_default: boolean;
  receipt_printer: string;
  reports_printer: string;
  delivery_printer?: string;
  default_printer: string;
  profile: {
    format: string;
    copies: number;
    auto_print: boolean;
    mode: string;
  };
  per_printer?: Record<string, { format?: string; copies?: number }>;
  note?: string;
}

export interface PrintJob {
  id: number;
  document_type: string;
  document_ref?: string | null;
  title: string;
  printer_name?: string | null;
  paper_format: string;
  copies: number;
  status: string;
  error_message?: string | null;
  created_at?: string;
}

export interface DeliveryOrderItem {
  id: number;
  product_id?: number | null;
  product_name: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
  is_misc?: number;
  checked_qty?: number;
  remaining_qty?: number;
  check_status?: 'PENDENTE' | 'PARCIAL' | 'CONFERIDO' | string;
  product_barcode?: string | null;
  product_sku?: string | null;
}

export interface DeliveryOrder {
  id: number;
  order_number: string;
  customer_id?: number | null;
  customer_name?: string | null;
  phone?: string | null;
  address?: string | null;
  address_number?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  status: string;
  payment_status: string;
  total_cents: number;
  amount_paid_cents: number;
  amount_due_cents?: number;
  sale_id?: number | null;
  cancel_reason?: string | null;
  created_by?: string | null;
  created_at?: string;
  paid_at?: string | null;
  all_items_checked?: boolean;
  items?: DeliveryOrderItem[];
  payments?: Array<{
    id: number;
    method: string;
    amount_cents: number;
    user_name?: string | null;
    created_at?: string;
  }>;
  history?: Array<{
    id: number;
    from_status?: string;
    to_status: string;
    note?: string;
    user_name?: string | null;
    created_at?: string;
  }>;
  reservations?: Array<{ id: number; product_id: number; quantity: number; status: string }>;
  scans?: Array<{
    id: number;
    barcode_read?: string | null;
    product_name?: string | null;
    quantity: number;
    method: string;
    user_name?: string | null;
    created_at?: string;
  }>;
}

export interface SettingsBundle {
  company: Record<string, string>;
  pdv: Record<string, string>;
  logo?: LogoMeta;
  printers?: PrinterSettings;
  app_version?: string;
}

export interface AppUser {
  id: number;
  name: string;
  login: string;
  role: string;
  active: number;
  must_change_password?: number;
  last_login_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ReportCatalogItem {
  id: string;
  title: string;
}

export interface ReportResult {
  id: string;
  title: string;
  filters?: Record<string, unknown>;
  generated_at?: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  totals?: Record<string, unknown>;
}

export interface BackupRecord {
  id: number;
  filename: string;
  filepath: string;
  size_bytes?: number;
  sha256?: string;
  app_version?: string;
  db_schema_version?: string;
  kind?: string;
  created_by?: string | null;
  notes?: string | null;
  created_at?: string;
  valid?: number | boolean;
  exists?: boolean;
}

export interface ImportRun {
  id: number;
  source_filename?: string;
  status?: string;
  preview?: Record<string, unknown>;
  analysis?: Record<string, unknown>;
  report_json?: string | Record<string, unknown> | null;
  created_at?: string;
  created_by?: string | null;
  importer_version?: string;
  sha256?: string;
  [key: string]: unknown;
}

export interface AuditLog {
  id: number;
  action: string;
  entity_type?: string | null;
  entity_id?: number | null;
  details?: unknown;
  user_name?: string | null;
  user_id?: number | null;
  result?: string | null;
  created_at: string;
}

export function loginApi(login: string, password: string): Promise<AuthSession> {
  return apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  })
    .then((r) => handle<AuthSession>(r))
    .then((session) => {
      setAuthSession(session);
      return session;
    });
}

export function logoutApi(): Promise<{ ok: boolean }> {
  return apiFetch('/api/auth/logout', { method: 'POST' }).then((r) =>
    handle<{ ok: boolean }>(r)
  );
}

export function fetchMe(): Promise<{ user: AuthUser }> {
  return apiFetch('/api/auth/me').then((r) => handle<{ user: AuthUser }>(r));
}

export function changePasswordApi(payload: {
  current_password: string;
  new_password: string;
}): Promise<{ user: AuthUser }> {
  return apiFetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle<{ user: AuthUser }>(r));
}

export function fetchSettings(): Promise<SettingsBundle> {
  return apiFetch('/api/settings').then((r) => handle<SettingsBundle>(r));
}

export function updateSettings(payload: Record<string, unknown>): Promise<SettingsBundle> {
  return apiFetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle<SettingsBundle>(r));
}

export function fetchLogoMeta(): Promise<LogoMeta> {
  return apiFetch('/api/settings/logo/meta').then((r) => handle<LogoMeta>(r));
}

export function uploadLogoApi(filename: string, content_base64: string): Promise<LogoMeta> {
  return apiFetch('/api/settings/logo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, content_base64 }),
  }).then((r) => handle<LogoMeta>(r));
}

export function removeLogoApi(): Promise<LogoMeta> {
  return apiFetch('/api/settings/logo', { method: 'DELETE' }).then((r) => handle<LogoMeta>(r));
}

export function fetchPrinterSettings(): Promise<PrinterSettings> {
  return apiFetch('/api/settings/printers').then((r) => handle<PrinterSettings>(r));
}

export function updatePrinterSettingsApi(
  payload: Partial<PrinterSettings> & { profile?: Partial<PrinterSettings['profile']> }
): Promise<PrinterSettings> {
  return apiFetch('/api/settings/printers', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle<PrinterSettings>(r));
}

export function exportPrinterConfigApi(): Promise<Record<string, unknown>> {
  return apiFetch('/api/settings/printers/export').then((r) => handle(r));
}

export function importPrinterConfigApi(payload: Record<string, unknown>): Promise<{
  settings: PrinterSettings;
  note?: string;
}> {
  return apiFetch('/api/settings/printers/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle(r));
}

export function matchPrintersApi(printers: string[]): Promise<Record<string, { configured: string; found: boolean }>> {
  return apiFetch('/api/settings/printers/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ printers }),
  }).then((r) => handle(r));
}

export function enqueuePrintJobApi(payload: Record<string, unknown>): Promise<PrintJob> {
  return apiFetch('/api/print/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle<PrintJob>(r));
}

export function fetchPrintJobsApi(status?: string): Promise<PrintJob[]> {
  return apiFetch(`/api/print/jobs${qs({ status })}`).then((r) => handle<PrintJob[]>(r));
}

export function markPrintJobResultApi(
  id: number,
  payload: { ok: boolean; error?: string; printer_name?: string }
): Promise<PrintJob> {
  return apiFetch(`/api/print/jobs/${id}/result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle<PrintJob>(r));
}

export function requeuePrintJobApi(id: number): Promise<PrintJob> {
  return apiFetch(`/api/print/jobs/${id}/requeue`, { method: 'POST' }).then((r) =>
    handle<PrintJob>(r)
  );
}

export function logDirectPrintApi(payload: Record<string, unknown>): Promise<{ ok: boolean }> {
  return apiFetch('/api/print/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle(r));
}

export function fetchDeliveryOrdersApi(params?: {
  status?: string;
  payment_status?: string;
}): Promise<DeliveryOrder[]> {
  return apiFetch(
    `/api/delivery-orders${qs({
      status: params?.status,
      payment_status: params?.payment_status,
    })}`
  ).then((r) => handle<DeliveryOrder[]>(r));
}

export function fetchDeliveryOrderApi(id: number): Promise<DeliveryOrder> {
  return apiFetch(`/api/delivery-orders/${id}`).then((r) => handle<DeliveryOrder>(r));
}

export function createDeliveryOrderApi(payload: Record<string, unknown>): Promise<DeliveryOrder> {
  return apiFetch('/api/delivery-orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle<DeliveryOrder>(r));
}

export function confirmDeliveryOrderPaymentApi(
  id: number,
  payload: Record<string, unknown>
): Promise<DeliveryOrder> {
  return apiFetch(`/api/delivery-orders/${id}/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle<DeliveryOrder>(r));
}

export function cancelDeliveryOrderApi(id: number, reason: string): Promise<DeliveryOrder> {
  return apiFetch(`/api/delivery-orders/${id}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  }).then((r) => handle<DeliveryOrder>(r));
}

export function updateDeliveryOrderStatusApi(
  id: number,
  status: string,
  note?: string,
  opts?: { allow_unchecked?: boolean }
): Promise<DeliveryOrder> {
  return apiFetch(`/api/delivery-orders/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status,
      note,
      allow_unchecked: opts?.allow_unchecked,
    }),
  }).then((r) => handle<DeliveryOrder>(r));
}

export function scanDeliveryOrderBarcodeApi(
  id: number,
  barcode: string
): Promise<{
  ok: boolean;
  beep?: boolean;
  message?: string;
  item?: DeliveryOrderItem;
  order: DeliveryOrder;
}> {
  return apiFetch(`/api/delivery-orders/${id}/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ barcode }),
  }).then((r) => handle(r));
}

export function confirmDeliveryOrderItemManualApi(
  id: number,
  itemId: number,
  quantity?: number
): Promise<DeliveryOrder> {
  return apiFetch(`/api/delivery-orders/${id}/items/${itemId}/confirm-manual`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity }),
  }).then((r) => handle<DeliveryOrder>(r));
}

export function resetPrinterSettingsApi(): Promise<{ settings: PrinterSettings; note?: string }> {
  return apiFetch('/api/settings/printers/reset', { method: 'POST' }).then((r) => handle(r));
}

export function fetchPrinterPortableStatusApi(): Promise<{
  ok: boolean;
  present?: boolean;
  needs_reconfigure?: boolean;
  error?: string;
}> {
  return apiFetch('/api/settings/printers/portable-status').then((r) => handle(r));
}

export function fetchUsers(): Promise<AppUser[]> {
  return apiFetch('/api/auth/users').then((r) => handle<AppUser[]>(r));
}

export function createUserApi(payload: {
  name: string;
  login: string;
  password: string;
  role?: string;
}): Promise<AppUser> {
  return apiFetch('/api/auth/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle<AppUser>(r));
}

export function updateUserApi(id: number, payload: Record<string, unknown>): Promise<AppUser> {
  return apiFetch(`/api/auth/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle<AppUser>(r));
}

export function changeUserPasswordApi(
  id: number,
  newPassword: string
): Promise<{ user: AppUser }> {
  return apiFetch(`/api/auth/users/${id}/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_password: newPassword }),
  }).then((r) => handle<{ user: AppUser }>(r));
}

export function fetchReportCatalog(): Promise<ReportCatalogItem[]> {
  return apiFetch('/api/reports').then((r) => handle<ReportCatalogItem[]>(r));
}

export function runReport(
  id: string,
  filters?: Record<string, string | number | undefined | null>
): Promise<ReportResult> {
  return apiFetch(`/api/reports/${encodeURIComponent(id)}${qs(filters || {})}`).then((r) =>
    handle<ReportResult>(r)
  );
}

export function createBackupApi(payload?: { notes?: string }): Promise<BackupRecord> {
  return apiFetch('/api/backups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  }).then((r) => handle<BackupRecord>(r));
}

export function listBackupsApi(): Promise<BackupRecord[]> {
  return apiFetch('/api/backups').then((r) => handle<BackupRecord[]>(r));
}

export function previewRestoreApi(filepath: string): Promise<Record<string, unknown>> {
  return apiFetch('/api/backups/restore/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filepath }),
  }).then((r) => handle<Record<string, unknown>>(r));
}

export function restoreBackupApi(filepath: string, confirm: boolean): Promise<Record<string, unknown>> {
  return apiFetch('/api/backups/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filepath, confirm }),
  }).then((r) => handle<Record<string, unknown>>(r));
}

export function uploadBackupApi(filename: string, contentBase64: string): Promise<Record<string, unknown>> {
  return apiFetch('/api/backups/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, content_base64: contentBase64 }),
  }).then((r) => handle<Record<string, unknown>>(r));
}

export function previewImportApi(payload: {
  filename?: string;
  content_base64?: string;
  json?: unknown;
}): Promise<ImportRun> {
  return apiFetch('/api/imports/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle<ImportRun>(r));
}

export function executeImportApi(payload: {
  filename?: string;
  content_base64?: string;
  json?: unknown;
  confirm: boolean;
  run_id?: number;
}): Promise<Record<string, unknown>> {
  return apiFetch('/api/imports/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => handle<Record<string, unknown>>(r));
}

export function listImportRunsApi(): Promise<ImportRun[]> {
  return apiFetch('/api/imports').then((r) => handle<ImportRun[]>(r));
}

export function fetchAuditLogs(params?: {
  limit?: number;
  offset?: number;
  action?: string;
  user_name?: string;
  from?: string;
  to?: string;
}): Promise<AuditLog[]> {
  return apiFetch(
    `/api/audit${qs({
      limit: params?.limit,
      offset: params?.offset,
      action: params?.action,
      user_name: params?.user_name,
      from: params?.from,
      to: params?.to,
    })}`
  ).then((r) => handle<AuditLog[]>(r));
}

export function buildReceiptPdfUrl(saleId: number): string {
  return `/api/receipts/sales/${saleId}/pdf`;
}

export function whatsappShareApi(
  saleId: number,
  opts?: { phone?: string; message?: string }
): Promise<{
  sale_id: number;
  sale_number: string;
  phone: string | null;
  message: string;
  url: string;
  pdf_attached: boolean;
  note?: string;
}> {
  return apiFetch(`/api/receipts/sales/${saleId}/whatsapp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts || {}),
  }).then((r) => handle(r));
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
    reader.readAsDataURL(file);
  });
}
