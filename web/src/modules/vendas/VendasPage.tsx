import { useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelSale as cancelCompletedSale,
  createSale,
  fetchOpenCash,
  fetchProducts,
  fetchSale,
  fetchSales,
  formatBRL,
  paymentLabel,
  type CashSession,
  type Customer,
  type Product,
  type Sale,
} from '../../api/client';
import CustomerPicker from './CustomerPicker';
import MiscItemModal from './MiscItemModal';
import MixedPaymentModal, { type MixedAmounts } from './MixedPaymentModal';
import ReceiptModal from './ReceiptModal';
import SalesHistoryModal from './SalesHistoryModal';
import {
  lineTotal,
  miscLine,
  productToLine,
  type CartLine,
  type PaymentMethod,
} from './types';

const PAYMENTS_ROW1: { id: PaymentMethod; label: string }[] = [
  { id: 'dinheiro', label: 'Dinheiro' },
  { id: 'pix', label: 'Pix' },
  { id: 'cartao', label: 'Cartão' },
];
const PAYMENTS_ROW2: { id: PaymentMethod; label: string }[] = [
  { id: 'crediario', label: 'Crediário' },
  { id: 'misto', label: 'Misto' },
];

function parseDiscountInput(value: string): { ok: true; cents: number } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, cents: 0 };
  if (trimmed.includes('-')) {
    return { ok: false, error: 'Desconto não pode ser negativo.' };
  }
  const normalized = trimmed.replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, error: 'Desconto inválido.' };
  }
  return { ok: true, cents: Math.round(n * 100) };
}

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function VendasPage() {
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [payment, setPayment] = useState<PaymentMethod>('dinheiro');
  const [creditEntryInput, setCreditEntryInput] = useState('0,00');
  const [creditInstallments, setCreditInstallments] = useState(1);
  const [creditFirstDue, setCreditFirstDue] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [cashReceivedInput, setCashReceivedInput] = useState('');
  const [discountInput, setDiscountInput] = useState('0,00');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showMisc, setShowMisc] = useState(false);
  const [showMixed, setShowMixed] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [mixedDraft, setMixedDraft] = useState<MixedAmounts | null>(null);
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [cash, setCash] = useState<CashSession | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<number | null>(null);
  const submittingRef = useRef(false);
  const requestIdRef = useRef<string | null>(null);
  const lastBarcodeRef = useRef<{ code: string; at: number } | null>(null);

  async function loadSales() {
    const list = await fetchSales(30);
    setSales(list);
  }

  async function loadProducts(q?: string, barcode?: string) {
    const list = await fetchProducts({ q, barcode });
    setProducts(list);
    return list;
  }

  async function loadCash() {
    setCash(await fetchOpenCash());
  }

  useEffect(() => {
    (async () => {
      try {
        await Promise.all([loadProducts(), loadSales(), loadCash()]);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao carregar dados');
      } finally {
        setLoading(false);
        searchRef.current?.focus();
      }
    })();
  }, []);

  useEffect(() => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(async () => {
      try {
        await loadProducts(query.trim() || undefined);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro na busca');
      }
    }, 220);
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    };
  }, [query]);

  const subtotal = useMemo(() => cart.reduce((sum, line) => sum + lineTotal(line), 0), [cart]);
  const parsedDiscount = parseDiscountInput(discountInput);
  const discountCents =
    parsedDiscount.ok ? Math.min(parsedDiscount.cents, subtotal) : 0;
  const total = Math.max(subtotal - discountCents, 0);

  function addProduct(product: Product) {
    setError(null);
    setNotice(null);
    setReceipt(null);

    if (product.stock_qty <= 0 && !product.allow_negative_stock) {
      setError(`Sem estoque para "${product.name}".`);
      return;
    }

    setCart((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      if (existing) {
        const nextQty = existing.quantity + 1;
        if (
          existing.stockQty != null &&
          nextQty > existing.stockQty &&
          !existing.allowNegative
        ) {
          setError(`Estoque insuficiente para "${product.name}". Disponível: ${existing.stockQty}`);
          return prev;
        }
        return prev.map((l) =>
          l.productId === product.id ? { ...l, quantity: nextQty } : l
        );
      }
      return [...prev, productToLine(product, 1)];
    });
  }

  function changeQty(key: string, delta: number) {
    setError(null);
    setCart((prev) =>
      prev
        .map((line) => {
          if (line.key !== key) return line;
          const nextQty = line.quantity + delta;
          if (nextQty <= 0) return { ...line, quantity: 0 };
          if (
            !line.isMisc &&
            line.stockQty != null &&
            nextQty > line.stockQty &&
            !line.allowNegative
          ) {
            setError(`Estoque insuficiente para "${line.name}". Disponível: ${line.stockQty}`);
            return line;
          }
          setQtyDrafts((d) => {
            const next = { ...d };
            delete next[key];
            return next;
          });
          return { ...line, quantity: nextQty };
        })
        .filter((l) => l.quantity > 0)
    );
  }

  function applyQtyInput(key: string) {
    const raw = qtyDrafts[key];
    if (raw == null) return;
    const n = Number(String(raw).replace(',', '.'));
    setError(null);
    if (!Number.isInteger(n) || n <= 0) {
      setError('Quantidade inválida.');
      setQtyDrafts((d) => {
        const next = { ...d };
        delete next[key];
        return next;
      });
      return;
    }
    setCart((prev) =>
      prev
        .map((line) => {
          if (line.key !== key) return line;
          if (
            !line.isMisc &&
            line.stockQty != null &&
            n > line.stockQty &&
            !line.allowNegative
          ) {
            setError(`Estoque insuficiente para "${line.name}". Disponível: ${line.stockQty}`);
            return line;
          }
          return { ...line, quantity: n };
        })
        .filter((l) => l.quantity > 0)
    );
    setQtyDrafts((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });
  }

  function removeLine(key: string) {
    setCart((prev) => prev.filter((l) => l.key !== key));
  }

  function cancelSale() {
    if (cart.length === 0) return;
    setCart([]);
    setDiscountInput('0,00');
    setPayment('dinheiro');
    setError(null);
    setNotice('Venda cancelada antes da conclusão. Nada foi registrado.');
    setReceipt(null);
    requestIdRef.current = null;
    searchRef.current?.focus();
  }

  async function handleBarcodeOrSearch() {
    const term = query.trim();
    if (!term) return;

    // Leitura típica de leitor: código numérico longo → busca exata por barcode
    const looksLikeBarcode = /^[0-9]{8,14}$/.test(term);
    try {
      if (looksLikeBarcode) {
        const now = Date.now();
        const last = lastBarcodeRef.current;
        if (last && last.code === term && now - last.at < 450) {
          setQuery('');
          searchRef.current?.focus();
          return;
        }
        lastBarcodeRef.current = { code: term, at: now };
        const found = await loadProducts(undefined, term);
        if (found.length === 1) {
          addProduct(found[0]);
          setQuery('');
          searchRef.current?.focus();
          return;
        }
        if (found.length === 0) {
          setError(`Nenhum produto com código de barras ${term}`);
          return;
        }
      }

      const found = await loadProducts(term);
      if (found.length === 1) {
        addProduct(found[0]);
        setQuery('');
        searchRef.current?.focus();
      } else if (found.length === 0) {
        setError('Nenhum produto encontrado.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro na busca');
    }
  }

  async function finalizeSale(mixedOverride?: MixedAmounts) {
    if (cart.length === 0 || submittingRef.current) return;

    const discountParse = parseDiscountInput(discountInput);
    if (!discountParse.ok) {
      setError(discountParse.error);
      return;
    }
    if (discountParse.cents > subtotal) {
      setError('Desconto não pode ser maior que o subtotal.');
      return;
    }

    const mode = mixedOverride ? 'misto' : payment;
    if (mode === 'misto' && !mixedOverride && !mixedDraft) {
      setShowMixed(true);
      return;
    }
    const mixed = mixedOverride || mixedDraft;

    if ((mode === 'crediario' || (mixed && mixed.crediario > 0)) && !customer) {
      setError('Venda no crediário exige cliente selecionado.');
      return;
    }
    if (mode === 'crediario') {
      const entryNorm = creditEntryInput.trim().replace(/\./g, '').replace(',', '.');
      const entryN = Number(entryNorm || '0');
      if (!Number.isFinite(entryN) || entryN < 0) {
        setError('Entrada do crediário inválida.');
        return;
      }
      if (!Number.isInteger(creditInstallments) || creditInstallments < 1) {
        setError('Número de parcelas inválido.');
        return;
      }
    }

    let amountReceivedCents: number | undefined;
    if (mode === 'dinheiro') {
      const raw = cashReceivedInput.trim();
      if (raw) {
        const n = Number(raw.replace(/\./g, '').replace(',', '.'));
        if (!Number.isFinite(n) || n < 0) {
          setError('Valor recebido inválido.');
          return;
        }
        amountReceivedCents = Math.round(n * 100);
        if (amountReceivedCents < total) {
          setError('Valor recebido menor que o total.');
          return;
        }
      }
    }

    await loadCash();
    const openCashNow = await fetchOpenCash();
    setCash(openCashNow);
    if (!openCashNow) {
      setError('Não há caixa aberto. Abra o caixa em Caixa antes de concluir a venda.');
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    setNotice(null);

    if (!requestIdRef.current) {
      requestIdRef.current = newRequestId();
    }

    try {
      const entryCents =
        mode === 'crediario'
          ? Math.round(
              Number(creditEntryInput.trim().replace(/\./g, '').replace(',', '.') || '0') * 100
            )
          : 0;

      const payments =
        mode === 'misto' && mixed
          ? (
              [
                { method: 'dinheiro', amount_cents: mixed.dinheiro },
                { method: 'pix', amount_cents: mixed.pix },
                { method: 'cartao', amount_cents: mixed.cartao },
                { method: 'crediario', amount_cents: mixed.crediario },
              ] as Array<{ method: string; amount_cents: number }>
            ).filter((p) => p.amount_cents > 0)
          : undefined;

      const sale = await createSale({
        payment_method: mode === 'misto' ? undefined : mode,
        payments,
        amount_received_cents:
          mode === 'misto' && mixed
            ? mixed.amount_received_cents
            : amountReceivedCents,
        discount_cents: discountParse.cents,
        client_request_id: requestIdRef.current,
        customer_id: customer?.id ?? null,
        items: cart.map((line) => ({
          product_id: line.productId,
          name: line.name,
          quantity: line.quantity,
          unit_price_cents: line.unitPriceCents,
          discount_cents: line.discountCents,
          is_misc: line.isMisc,
        })),
        credit:
          mode === 'crediario' || (mixed && mixed.crediario > 0)
            ? {
                entry_cents: mode === 'crediario' ? entryCents : 0,
                installment_count: mode === 'crediario' ? creditInstallments : 1,
                first_due_date: mode === 'crediario' ? creditFirstDue : undefined,
              }
            : undefined,
      });
      const full = await fetchSale(sale.id);
      setReceipt(full);
      setCart([]);
      setDiscountInput('0,00');
      setPayment('dinheiro');
      setCreditEntryInput('0,00');
      setCreditInstallments(1);
      setCashReceivedInput('');
      setMixedDraft(null);
      setShowMixed(false);
      setQtyDrafts({});
      requestIdRef.current = null;
      setNotice(`Venda ${full.sale_number} concluída com sucesso.`);
      await Promise.all([loadProducts(query.trim() || undefined), loadSales(), loadCash()]);
      searchRef.current?.focus();
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === 'CASH_SESSION_REQUIRED') {
        setError('Não há caixa aberto. Abra o caixa antes de concluir a venda.');
      } else if (err.code === 'CUSTOMER_REQUIRED_FOR_CREDIT') {
        setError('Venda no crediário exige cliente selecionado.');
      } else {
        setError(err.message || 'Erro ao finalizar a venda');
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function handleCancelSale(sale: Sale) {
    const reason = window.prompt('Motivo do cancelamento (obrigatório):');
    if (reason == null) return;
    if (!reason.trim()) {
      setError('Informe o motivo do cancelamento.');
      return;
    }
    try {
      const cancelled = await cancelCompletedSale(sale.id, { reason: reason.trim() });
      setReceipt(cancelled);
      setNotice(`Venda ${cancelled.sale_number} cancelada. Estoque estornado.`);
      await Promise.all([loadProducts(query.trim() || undefined), loadSales(), loadCash()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao cancelar venda');
    }
  }

  async function openSaleReceipt(id: number) {
    try {
      const sale = await fetchSale(id);
      setReceipt(sale);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao abrir comprovante');
    }
  }

  return (
    <div className="sales-layout">
      <section className="sales-main">
        <div className="sales-status-row">
          <span className={cash ? 'status-pill status-ok' : 'status-pill status-warn'}>
            {cash
              ? `Caixa aberto · ${cash.operator_name}`
              : 'Caixa fechado — abra o caixa para vender'}
          </span>
        </div>

        <CustomerPicker selected={customer} onSelect={setCustomer} />

        <div className="search-row">
          <input
            ref={searchRef}
            className="search-input"
            placeholder="Buscar produto ou ler código de barras…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleBarcodeOrSearch();
              }
            }}
            aria-label="Busca de produtos"
          />
          <button type="button" className="btn btn-primary" onClick={() => void handleBarcodeOrSearch()}>
            Buscar
          </button>
          <button type="button" className="btn btn-accent" onClick={() => setShowMisc(true)}>
            Item Diversos
          </button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {notice && <div className="alert alert-ok">{notice}</div>}

        <div className="results-meta">
          <span>{loading ? 'Carregando produtos…' : `${products.length} produto(s)`}</span>
          <span>Enter adiciona quando houver um único resultado</span>
        </div>

        <div className="product-table-wrap">
          <table className="product-table">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Código</th>
                <th>Categoria</th>
                <th>Estoque</th>
                <th>Preço</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} onClick={() => addProduct(product)}>
                  <td>{product.name}</td>
                  <td>{product.barcode || product.sku || '—'}</td>
                  <td>{product.category}</td>
                  <td className={product.stock_qty <= 5 ? 'stock stock-low' : 'stock stock-ok'}>
                    {product.stock_qty}
                  </td>
                  <td className="price">{formatBRL(product.price_cents)}</td>
                </tr>
              ))}
              {!loading && products.length === 0 && (
                <tr>
                  <td colSpan={5}>Nenhum produto encontrado para a busca.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="history-block">
          <h3>Histórico de vendas</h3>
          {sales.length === 0 ? (
            <p className="cart-empty" style={{ padding: '8px 0' }}>
              Nenhuma venda registrada ainda.
            </p>
          ) : (
            <table className="history-table">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Data</th>
                  <th>Pagamento</th>
                  <th>Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => (
                  <tr key={sale.id}>
                    <td>
                      {sale.sale_number}
                      {sale.status === 'cancelled' ? ' · cancelada' : ''}
                      {sale.customer_name ? ` · ${sale.customer_name}` : ''}
                    </td>
                    <td>{sale.created_at}</td>
                    <td>{paymentLabel(sale.payment_method)}</td>
                    <td>{formatBRL(sale.total_cents)}</td>
                    <td>
                      <button type="button" className="linkish" onClick={() => void openSaleReceipt(sale.id)}>
                        Comprovante
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <aside className="cart-panel">
        <h3>Carrinho</h3>

        {cart.length === 0 ? (
          <p className="cart-empty">
            Carrinho vazio.
            <br />
            Busque um produto ou leia o código de barras.
          </p>
        ) : (
          <ul className="cart-lines">
            {cart.map((line) => (
              <li key={line.key} className="cart-line">
                <div>
                  <div className="cart-line-name">
                    {line.name}
                    {line.isMisc && <span className="misc-tag">Diversos</span>}
                  </div>
                  <div className="cart-line-meta">
                    {formatBRL(line.unitPriceCents)} × {line.quantity}
                    {line.stockQty != null ? ` · est. ${line.stockQty}` : ''}
                  </div>
                </div>
                <div className="cart-line-actions">
                  <div className="qty-control">
                    <button type="button" aria-label="Diminuir" onClick={() => changeQty(line.key, -1)}>
                      −
                    </button>
                    <input
                      className="qty-input"
                      aria-label="Quantidade"
                      value={qtyDrafts[line.key] ?? String(line.quantity)}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) =>
                        setQtyDrafts((d) => ({ ...d, [line.key]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          applyQtyInput(line.key);
                        }
                      }}
                      onBlur={() => applyQtyInput(line.key)}
                      inputMode="numeric"
                    />
                    <button type="button" aria-label="Aumentar" onClick={() => changeQty(line.key, 1)}>
                      +
                    </button>
                  </div>
                  <span className="cart-line-total">{formatBRL(lineTotal(line))}</span>
                  <button type="button" className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={() => removeLine(line.key)}>
                    Remover
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="cart-summary">
          <div className="summary-row">
            <span>Subtotal</span>
            <strong>{formatBRL(subtotal)}</strong>
          </div>
          <div className="summary-row">
            <span>Desconto (R$)</span>
            <input
              value={discountInput}
              onChange={(e) => setDiscountInput(e.target.value)}
              inputMode="decimal"
              aria-label="Desconto da venda"
            />
          </div>

          <div className="total-block" data-testid="cart-total">
            <span>Total</span>
            <strong>{formatBRL(total)}</strong>
          </div>

          <div>
            <div className="summary-row" style={{ marginBottom: 8 }}>
              <span>Forma de pagamento</span>
            </div>
            <div className="payment-options">
              {PAYMENTS_ROW1.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={m.id === payment ? 'pay-btn active' : 'pay-btn'}
                  onClick={() => {
                    setPayment(m.id);
                    setMixedDraft(null);
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className="payment-options" style={{ marginTop: 8 }}>
              {PAYMENTS_ROW2.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={m.id === payment ? 'pay-btn active' : 'pay-btn'}
                  onClick={() => {
                    if (m.id === 'misto') {
                      setPayment('misto');
                      setShowMixed(true);
                      return;
                    }
                    setPayment(m.id);
                    setMixedDraft(null);
                  }}
                >
                  {m.label}
                </button>
              ))}
              <button
                type="button"
                className="pay-btn"
                onClick={() => setShowHistory(true)}
              >
                Histórico
              </button>
            </div>
            {payment === 'dinheiro' ? (
              <div className="credit-fields" style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                <label>
                  Valor recebido (R$)
                  <input
                    value={cashReceivedInput}
                    onChange={(e) => setCashReceivedInput(e.target.value)}
                    inputMode="decimal"
                    placeholder={(total / 100).toFixed(2).replace('.', ',')}
                  />
                </label>
                {cashReceivedInput.trim() &&
                Number.isFinite(Number(cashReceivedInput.replace(/\./g, '').replace(',', '.'))) ? (
                  <div className="muted-line">
                    Troco:{' '}
                    <strong>
                      {formatBRL(
                        Math.max(
                          0,
                          Math.round(
                            Number(cashReceivedInput.replace(/\./g, '').replace(',', '.')) * 100
                          ) - total
                        )
                      )}
                    </strong>
                  </div>
                ) : null}
              </div>
            ) : null}
            {payment === 'misto' && mixedDraft ? (
              <div className="muted-line" style={{ marginTop: 8 }}>
                Misto configurado · informado{' '}
                {formatBRL(
                  mixedDraft.dinheiro + mixedDraft.pix + mixedDraft.cartao + mixedDraft.crediario
                )}
                <button
                  type="button"
                  className="linkish"
                  style={{ marginLeft: 8 }}
                  onClick={() => setShowMixed(true)}
                >
                  Editar
                </button>
              </div>
            ) : null}
            {payment === 'crediario' ? (
              <div className="credit-fields" style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                <label>
                  Entrada (R$)
                  <input
                    value={creditEntryInput}
                    onChange={(e) => setCreditEntryInput(e.target.value)}
                    inputMode="decimal"
                  />
                </label>
                <label>
                  Parcelas
                  <input
                    type="number"
                    min={1}
                    value={creditInstallments}
                    onChange={(e) => setCreditInstallments(Math.max(1, Number(e.target.value) || 1))}
                  />
                </label>
                <label>
                  1º vencimento
                  <input
                    type="date"
                    value={creditFirstDue}
                    onChange={(e) => setCreditFirstDue(e.target.value)}
                  />
                </label>
                {!customer ? (
                  <span className="alert alert-error" style={{ margin: 0 }}>
                    Selecione um cliente para crediário.
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="cart-actions">
            <button
              type="button"
              className="btn btn-danger"
              onClick={cancelSale}
              disabled={cart.length === 0 || submitting}
            >
              Cancelar venda
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void finalizeSale()}
              disabled={cart.length === 0 || submitting}
            >
              {submitting ? 'Finalizando…' : 'Finalizar venda'}
            </button>
          </div>
        </div>
      </aside>

      {showMisc && (
        <MiscItemModal
          onCancel={() => setShowMisc(false)}
          onConfirm={(name, priceCents) => {
            setCart((prev) => [...prev, miscLine(name, priceCents)]);
            setShowMisc(false);
            setNotice(null);
            setError(null);
          }}
        />
      )}

      {showMixed && (
        <MixedPaymentModal
          totalCents={total}
          hasCustomer={Boolean(customer)}
          onCancel={() => {
            setShowMixed(false);
            if (!mixedDraft) setPayment('dinheiro');
          }}
          onConfirm={(payload) => {
            setMixedDraft(payload);
            setPayment('misto');
            setShowMixed(false);
            void finalizeSale(payload);
          }}
        />
      )}

      {showHistory && (
        <SalesHistoryModal
          onClose={() => setShowHistory(false)}
          onOpenSale={(sale) => {
            setShowHistory(false);
            setReceipt(sale);
          }}
        />
      )}

      {receipt && (
        <ReceiptModal
          sale={receipt}
          onClose={() => setReceipt(null)}
          onCancelSale={(sale) => void handleCancelSale(sale)}
        />
      )}
    </div>
  );
}
