import { useEffect, useState } from 'react';
import {
  fetchProductHistory,
  fetchStock,
  fetchStockMovements,
  formatBRL,
  getStoredAuthUser,
  type ProductHistory,
  type StockMovement,
  type StockRow,
} from '../../api/client';
import { ModuleToolbar, StatusPill } from '../../components/ModuleChrome';
import StockAdjustModal from './StockAdjustModal';

export default function EstoquePage() {
  const me = getStoredAuthUser();
  const canAdjust = me?.role === 'administrador';
  const [rows, setRows] = useState<StockRow[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [q, setQ] = useState('');
  const [onlyAlerts, setOnlyAlerts] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustProductId, setAdjustProductId] = useState<number | null>(null);
  const [history, setHistory] = useState<ProductHistory | null>(null);

  async function load() {
    try {
      const [stock, movs] = await Promise.all([
        fetchStock({ q: q.trim() || undefined, alerts: onlyAlerts }),
        fetchStockMovements({ limit: 80 }),
      ]);
      setRows(stock);
      setMovements(movs);
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

  async function openHistory(productId: number) {
    try {
      setHistory(await fetchProductHistory(productId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar histórico');
    }
  }

  function openAdjust(productId?: number) {
    if (!canAdjust) {
      setError('Somente administrador pode ajustar estoque.');
      return;
    }
    setAdjustProductId(productId ?? null);
    setShowAdjust(true);
    setError(null);
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
        {canAdjust && (
          <button type="button" className="btn btn-primary" onClick={() => openAdjust()}>
            Ajustar estoque
          </button>
        )}
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
                  <td className="row-actions">
                    {canAdjust && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => openAdjust(r.id)}
                      >
                        Ajustar
                      </button>
                    )}
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
                  <th>Motivo</th>
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
                    <td>{m.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showAdjust && (
        <StockAdjustModal
          initialProductId={adjustProductId}
          onClose={() => {
            setShowAdjust(false);
            setAdjustProductId(null);
          }}
          onDone={async (result) => {
            setShowAdjust(false);
            setAdjustProductId(null);
            setNotice(
              `Estoque ajustado: ${result.stock_before} → ${result.stock_after}`
            );
            await load();
          }}
          onError={(msg) => setError(msg)}
        />
      )}

      {history && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal modal-wide" style={{ width: 'min(920px, 100%)' }}>
            <h3>Histórico do produto</h3>
            <p>
              <strong>{history.product.name}</strong> · estoque atual {history.product.stock_qty} ·{' '}
              {formatBRL(history.product.price_cents)}
            </p>
            <div className="cash-grid">
              <div className="side-card">
                <h3>Movimentações</h3>
                <div className="product-table-wrap compact" style={{ maxHeight: 240, overflow: 'auto' }}>
                  <table className="history-table">
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Tipo</th>
                        <th>Antes</th>
                        <th>Δ</th>
                        <th>Depois</th>
                        <th>Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.movements.slice(0, 40).map((m) => (
                        <tr key={m.id}>
                          <td>{m.created_at}</td>
                          <td>{m.movement_type}</td>
                          <td>{m.stock_before ?? m.stock_after - m.quantity_delta}</td>
                          <td>{m.quantity_delta}</td>
                          <td>{m.stock_after}</td>
                          <td>{m.reason || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="side-card">
                <h3>Vendas recentes</h3>
                <pre className="code-block" style={{ maxHeight: 220, overflow: 'auto' }}>
                  {JSON.stringify(history.sales.slice(0, 20), null, 2)}
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
