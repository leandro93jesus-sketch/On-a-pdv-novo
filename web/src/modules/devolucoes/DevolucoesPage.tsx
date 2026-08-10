import { useEffect, useState } from 'react';
import {
  createReturn,
  fetchReturns,
  fetchSale,
  fetchSales,
  formatBRL,
  type ReturnRecord,
  type Sale,
  type SaleItem,
} from '../../api/client';
import { ModuleToolbar } from '../../components/ModuleChrome';

type QtyMap = Record<number, number>;

export default function DevolucoesPage() {
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [qtys, setQtys] = useState<QtyMap>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    try {
      const [r, s] = await Promise.all([fetchReturns(), fetchSales(80)]);
      setReturns(r);
      setSales(s.filter((x) => x.status !== 'cancelled'));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar devoluções');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function pickSale(id: number) {
    try {
      const sale = await fetchSale(id);
      setSelectedSale(sale);
      const map: QtyMap = {};
      for (const item of sale.items || []) {
        map[item.id] = 0;
      }
      setQtys(map);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao abrir venda');
    }
  }

  async function submit() {
    if (!selectedSale) return;
    if (!reason.trim()) {
      setError('Motivo é obrigatório');
      return;
    }
    const items = (selectedSale.items || [])
      .filter((i) => (qtys[i.id] || 0) > 0)
      .map((i) => ({ sale_item_id: i.id, quantity: qtys[i.id] }));
    if (items.length === 0) {
      setError('Selecione ao menos um item com quantidade');
      return;
    }
    try {
      const created = await createReturn({
        sale_id: selectedSale.id,
        reason: reason.trim(),
        items,
      });
      setShowForm(false);
      setSelectedSale(null);
      setReason('');
      setNotice(`Devolução ${created.return_number} registrada. Estoque atualizado.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao devolver');
    }
  }

  function setQty(item: SaleItem, value: number) {
    const max = item.quantity;
    setQtys((prev) => ({ ...prev, [item.id]: Math.max(0, Math.min(max, value)) }));
  }

  return (
    <section className="module-panel">
      <ModuleToolbar>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setShowForm(true);
            setError(null);
          }}
        >
          Nova devolução
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          Atualizar
        </button>
      </ModuleToolbar>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}

      <div className="product-table-wrap">
        <table className="product-table">
          <thead>
            <tr>
              <th>Número</th>
              <th>Venda</th>
              <th>Motivo</th>
              <th>Total</th>
              <th>Data</th>
              <th>Usuário</th>
            </tr>
          </thead>
          <tbody>
            {returns.map((r) => (
              <tr key={r.id}>
                <td>{r.return_number}</td>
                <td>{r.sale_number || r.sale_id}</td>
                <td>{r.reason}</td>
                <td>{formatBRL(r.total_cents)}</td>
                <td>{r.created_at}</td>
                <td>{r.user_name || '—'}</td>
              </tr>
            ))}
            {returns.length === 0 && (
              <tr>
                <td colSpan={6}>Nenhuma devolução registrada.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="modal-backdrop">
          <div className="modal modal-wide">
            <h3>Nova devolução</h3>
            <label>
              Venda *
              <select
                className="field-input"
                value={selectedSale?.id || ''}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  if (id) void pickSale(id);
                }}
              >
                <option value="">Selecione a venda…</option>
                {sales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.sale_number} · {formatBRL(s.total_cents)} · {s.customer_name || 'Sem cliente'}
                  </option>
                ))}
              </select>
            </label>

            {selectedSale ? (
              <>
                <table className="product-table" style={{ marginTop: '0.75rem' }}>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Vendido</th>
                      <th>Devolver</th>
                      <th>Preço</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedSale.items || []).map((item) => (
                      <tr key={item.id}>
                        <td>{item.name}</td>
                        <td>{item.quantity}</td>
                        <td>
                          <input
                            className="field-input"
                            style={{ width: 80 }}
                            type="number"
                            min={0}
                            max={item.quantity}
                            value={qtys[item.id] ?? 0}
                            onChange={(e) => setQty(item, Number(e.target.value) || 0)}
                          />
                        </td>
                        <td>{formatBRL(item.unit_price_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <label style={{ display: 'block', marginTop: '0.75rem' }}>
                  Motivo *
                  <input
                    className="field-input"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Obrigatório"
                  />
                </label>
              </>
            ) : null}

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setShowForm(false);
                  setSelectedSale(null);
                }}
              >
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void submit()}>
                Registrar devolução
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
