import { useEffect, useState } from 'react';
import {
  createStockMovement,
  fetchProducts,
  fetchStock,
  fetchStockMovements,
  type Product,
  type StockMovement,
  type StockRow,
} from '../../api/client';
import { ModuleToolbar, StatusPill } from '../../components/ModuleChrome';

const TYPES = [
  { id: 'entry', label: 'Entrada' },
  { id: 'exit', label: 'Saída' },
  { id: 'adjust_in', label: 'Ajuste +' },
  { id: 'adjust_out', label: 'Ajuste -' },
  { id: 'purchase', label: 'Compra' },
  { id: 'return', label: 'Devolução' },
];

export default function EstoquePage() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState('');
  const [onlyAlerts, setOnlyAlerts] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showMove, setShowMove] = useState(false);
  const [form, setForm] = useState({
    product_id: '',
    movement_type: 'entry',
    quantity: '1',
    reason: '',
  });

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
      void (async () => {
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
      })();
    }, 200);
    return () => window.clearTimeout(t);
  }, [q, onlyAlerts]);

  async function submitMove() {
    if (!form.product_id || !form.reason.trim()) {
      setError('Produto e motivo são obrigatórios');
      return;
    }
    try {
      await createStockMovement({
        product_id: Number(form.product_id),
        movement_type: form.movement_type,
        quantity: Number(form.quantity),
        reason: form.reason.trim(),
      });
      setShowMove(false);
      setNotice('Movimentação registrada.');
      setForm({ product_id: '', movement_type: 'entry', quantity: '1', reason: '' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro na movimentação');
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
          <input type="checkbox" checked={onlyAlerts} onChange={(e) => setOnlyAlerts(e.target.checked)} />
          Somente alertas
        </label>
        <button type="button" className="btn btn-primary" onClick={() => setShowMove(true)}>
          Nova movimentação
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
                      tone={r.situation === 'zerado' ? 'danger' : r.situation === 'baixo' ? 'warn' : 'ok'}
                    >
                      {r.situation === 'zerado' ? 'Zerado' : r.situation === 'baixo' ? 'Baixo' : 'OK'}
                    </StatusPill>
                  </td>
                  <td>{r.last_movement_at || '—'}</td>
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
                    <td>{m.quantity_delta}</td>
                    <td>{m.stock_after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showMove && (
        <div className="modal-backdrop">
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              void submitMove();
            }}
          >
            <h3>Movimentação de estoque</h3>
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
              <label>
                Tipo
                <select
                  className="field-input"
                  value={form.movement_type}
                  onChange={(e) => setForm({ ...form, movement_type: e.target.value })}
                >
                  {TYPES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Quantidade
                <input
                  className="field-input"
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                />
              </label>
              <label>
                Motivo *
                <input
                  className="field-input"
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowMove(false)}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary">
                Confirmar
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
