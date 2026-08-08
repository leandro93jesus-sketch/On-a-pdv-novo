import { useEffect, useMemo, useState } from 'react';
import {
  createStockMovement,
  fetchProductHistory,
  fetchProducts,
  fetchStock,
  fetchStockMovements,
  formatBRL,
  setStockBalanceApi,
  type Product,
  type ProductHistory,
  type StockMovement,
  type StockRow,
} from '../../api/client';
import { ModuleToolbar, StatusPill } from '../../components/ModuleChrome';

type AdjustMode = 'entry' | 'exit' | 'set_balance';

export default function EstoquePage() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState('');
  const [onlyAlerts, setOnlyAlerts] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAdjust, setShowAdjust] = useState(false);
  const [form, setForm] = useState({
    product_id: '',
    mode: 'entry' as AdjustMode,
    quantity: '1',
    new_qty: '',
    reason: '',
    note: '',
  });
  const [history, setHistory] = useState<ProductHistory | null>(null);

  const selectedProduct = useMemo(
    () => products.find((p) => String(p.id) === form.product_id) || null,
    [products, form.product_id]
  );

  const previewNewStock = useMemo(() => {
    if (!selectedProduct) return null;
    if (form.mode === 'set_balance') {
      const n = Number(form.new_qty);
      return Number.isInteger(n) ? n : null;
    }
    const qty = Number(form.quantity);
    if (!Number.isInteger(qty) || qty <= 0) return null;
    return form.mode === 'entry'
      ? selectedProduct.stock_qty + qty
      : selectedProduct.stock_qty - qty;
  }, [selectedProduct, form]);

  async function load() {
    try {
      const [stock, movs, prods] = await Promise.all([
        fetchStock({ q: q.trim() || undefined, alerts: onlyAlerts }),
        fetchStockMovements({ limit: 80 }),
        fetchProducts(),
      ]);
      setRows(stock);
      setMovements(movs);
      setProducts(prods);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar estoque');
    }
  }

  useEffect(() => {
    const t = window.setTimeout(() => {
      void load();
    }, 200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, onlyAlerts]);

  async function submitAdjust() {
    if (!form.product_id || !form.reason.trim()) {
      setError('Produto e motivo são obrigatórios');
      return;
    }
    try {
      if (form.mode === 'set_balance') {
        const newQty = Number(form.new_qty);
        if (!Number.isInteger(newQty) || newQty < 0) {
          setError('Novo saldo inválido');
          return;
        }
        const res = await setStockBalanceApi({
          product_id: Number(form.product_id),
          new_qty: newQty,
          reason: form.reason.trim(),
          note: form.note.trim() || undefined,
        });
        setNotice(
          `Saldo definido: ${res.stock_before} → ${res.stock_after} (Δ ${res.quantity_delta})`
        );
      } else {
        await createStockMovement({
          product_id: Number(form.product_id),
          movement_type: form.mode,
          quantity: Number(form.quantity),
          reason: form.reason.trim(),
          note: form.note.trim() || undefined,
        });
        setNotice(form.mode === 'entry' ? 'Entrada registrada.' : 'Saída registrada.');
      }
      setShowAdjust(false);
      setForm({
        product_id: '',
        mode: 'entry',
        quantity: '1',
        new_qty: '',
        reason: '',
        note: '',
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro no ajuste');
    }
  }

  async function openHistory(productId: number) {
    try {
      setHistory(await fetchProductHistory(productId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar histórico');
    }
  }

  return (
    <section className="module-panel">
      <ModuleToolbar>
        <input
          className="search-input"
          placeholder="Filtrar produtos…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="check-inline">
          <input
            type="checkbox"
            checked={onlyAlerts}
            onChange={(e) => setOnlyAlerts(e.target.checked)}
          />
          Somente alertas
        </label>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setShowAdjust(true);
            setError(null);
          }}
        >
          Ajustar estoque
        </button>
      </ModuleToolbar>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}

      <div className="split-panels">
        <div className="product-table-wrap">
          <table className="product-table">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Código</th>
                <th>Categoria</th>
                <th>Atual</th>
                <th>Mínimo</th>
                <th>Situação</th>
                <th>Última mov.</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.situation !== 'ok' ? 'row-alert' : undefined}>
                  <td>{r.name}</td>
                  <td>{r.barcode || r.sku || '—'}</td>
                  <td>{r.category}</td>
                  <td className={r.situation === 'ok' ? 'stock stock-ok' : 'stock stock-low'}>
                    {r.stock_qty} {r.unit}
                  </td>
                  <td>{r.min_stock_qty}</td>
                  <td>
                    <StatusPill
                      tone={
                        r.situation === 'zerado' ? 'danger' : r.situation === 'baixo' ? 'warn' : 'ok'
                      }
                    >
                      {r.situation === 'zerado' ? 'Zerado' : r.situation === 'baixo' ? 'Baixo' : 'OK'}
                    </StatusPill>
                  </td>
                  <td>{r.last_movement_at || '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => void openHistory(r.id)}
                    >
                      Histórico
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="side-card">
          <h3>Histórico de movimentações</h3>
          <div className="product-table-wrap compact">
            <table className="history-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Produto</th>
                  <th>Tipo</th>
                  <th>Antes</th>
                  <th>Δ</th>
                  <th>Saldo</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td>{m.created_at}</td>
                    <td>{m.product_name}</td>
                    <td>{m.movement_type}</td>
                    <td>
                      {(m as StockMovement & { stock_before?: number }).stock_before ??
                        m.stock_after - m.quantity_delta}
                    </td>
                    <td>{m.quantity_delta}</td>
                    <td>{m.stock_after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showAdjust && (
        <div className="modal-backdrop">
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              void submitAdjust();
            }}
          >
            <h3>Ajustar estoque</h3>
            <div className="modal-fields">
              <label>
                Produto
                <select
                  className="field-input"
                  value={form.product_id}
                  onChange={(e) => setForm({ ...form, product_id: e.target.value })}
                >
                  <option value="">Selecione…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (est. {p.stock_qty})
                    </option>
                  ))}
                </select>
              </label>
              {selectedProduct && (
                <div className="muted-line">
                  Código: {selectedProduct.sku || '—'} · Barras: {selectedProduct.barcode || '—'} ·
                  Estoque atual: <strong>{selectedProduct.stock_qty}</strong>
                </div>
              )}
              <label>
                Operação
                <select
                  className="field-input"
                  value={form.mode}
                  onChange={(e) => setForm({ ...form, mode: e.target.value as AdjustMode })}
                >
                  <option value="entry">Entrada</option>
                  <option value="exit">Saída</option>
                  <option value="set_balance">Definir saldo</option>
                </select>
              </label>
              {form.mode === 'set_balance' ? (
                <label>
                  Novo saldo
                  <input
                    className="field-input"
                    value={form.new_qty}
                    onChange={(e) => setForm({ ...form, new_qty: e.target.value })}
                  />
                </label>
              ) : (
                <label>
                  Quantidade
                  <input
                    className="field-input"
                    value={form.quantity}
                    onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  />
                </label>
              )}
              {previewNewStock != null && selectedProduct && (
                <div className="muted-line">
                  Novo estoque previsto: <strong>{previewNewStock}</strong>
                  {form.mode === 'set_balance'
                    ? ` (movimentação Δ ${previewNewStock - selectedProduct.stock_qty})`
                    : ''}
                </div>
              )}
              <label>
                Motivo *
                <input
                  className="field-input"
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                />
              </label>
              <label>
                Observação
                <input
                  className="field-input"
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowAdjust(false)}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary">
                Confirmar
              </button>
            </div>
          </form>
        </div>
      )}

      {history && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal modal-wide" style={{ width: 'min(920px, 100%)' }}>
            <h3>Histórico do produto</h3>
            <p>
              <strong>{history.product.name}</strong> · estoque {history.product.stock_qty} ·{' '}
              {formatBRL(history.product.price_cents)}
            </p>
            <div className="cash-grid">
              <div className="side-card">
                <h3>Movimentações</h3>
                <pre className="code-block" style={{ maxHeight: 220, overflow: 'auto' }}>
                  {JSON.stringify(history.movements.slice(0, 30), null, 2)}
                </pre>
              </div>
              <div className="side-card">
                <h3>Vendas</h3>
                <pre className="code-block" style={{ maxHeight: 220, overflow: 'auto' }}>
                  {JSON.stringify(history.sales.slice(0, 30), null, 2)}
                </pre>
              </div>
              <div className="side-card">
                <h3>Compras / Devoluções</h3>
                <pre className="code-block" style={{ maxHeight: 220, overflow: 'auto' }}>
                  {JSON.stringify(
                    { purchases: history.purchases.slice(0, 20), returns: history.returns.slice(0, 20) },
                    null,
                    2
                  )}
                </pre>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setHistory(null)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
