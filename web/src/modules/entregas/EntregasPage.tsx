import { useEffect, useState } from 'react';
import {
  createDelivery,
  fetchDeliveries,
  fetchDelivery,
  fetchSales,
  formatBRL,
  updateDeliveryStatus,
  type Delivery,
  type Sale,
} from '../../api/client';
import { ModuleToolbar, StatusPill } from '../../components/ModuleChrome';
import DeliveryOrdersPanel from './DeliveryOrdersPanel';

const STATUSES = [
  'pendente',
  'separando',
  'saiu_para_entrega',
  'entregue',
  'nao_entregue',
  'cancelada',
] as const;

function tone(status: string): 'ok' | 'warn' | 'danger' | 'muted' | 'info' {
  if (status === 'entregue') return 'ok';
  if (status === 'pendente' || status === 'separando') return 'warn';
  if (status === 'saiu_para_entrega') return 'info';
  if (status === 'nao_entregue' || status === 'cancelada') return 'danger';
  return 'muted';
}

export default function EntregasPage() {
  const [mode, setMode] = useState<'pedidos' | 'logistica'>('pedidos');
  const [items, setItems] = useState<Delivery[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [selected, setSelected] = useState<Delivery | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [courierFilter, setCourierFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saleId, setSaleId] = useState<number | ''>('');
  const [scheduledDate, setScheduledDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [period, setPeriod] = useState('manhã');
  const [courierName, setCourierName] = useState('');
  const [notes, setNotes] = useState('');
  const [statusNote, setStatusNote] = useState('');

  async function load() {
    try {
      const [d, s] = await Promise.all([
        fetchDeliveries({
          status: statusFilter || undefined,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          courier: courierFilter.trim() || undefined,
        }),
        fetchSales(80),
      ]);
      setItems(d);
      setSales(s.filter((x) => x.status !== 'cancelled'));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar entregas');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, dateFrom, dateTo, courierFilter]);

  async function openDelivery(id: number) {
    try {
      setSelected(await fetchDelivery(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao abrir entrega');
    }
  }

  async function submit() {
    if (!saleId) {
      setError('Selecione a venda');
      return;
    }
    try {
      const created = await createDelivery({
        sale_id: saleId,
        scheduled_date: scheduledDate,
        period,
        courier_name: courierName.trim() || null,
        notes: notes.trim() || null,
      });
      setShowForm(false);
      setNotice(`Entrega #${created.id} criada.`);
      await load();
      await openDelivery(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao criar entrega');
    }
  }

  async function changeStatus(status: string) {
    if (!selected) return;
    try {
      const updated = await updateDeliveryStatus(selected.id, {
        status,
        note: statusNote.trim() || undefined,
        courier_name: courierName.trim() || undefined,
      });
      setSelected(updated);
      setStatusNote('');
      setNotice(`Status alterado para ${status}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao alterar status');
    }
  }

  return (
    <section className="module-panel">
      <ModuleToolbar>
        <button
          type="button"
          className={`btn ${mode === 'pedidos' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setMode('pedidos')}
        >
          Pedidos (pagamento)
        </button>
        <button
          type="button"
          className={`btn ${mode === 'logistica' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setMode('logistica')}
        >
          Logística (venda paga)
        </button>
      </ModuleToolbar>

      {mode === 'pedidos' ? (
        <DeliveryOrdersPanel />
      ) : (
        <>
      <ModuleToolbar>
        <select
          className="field-input"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">Todos os status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          className="field-input"
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          title="Data de"
        />
        <input
          className="field-input"
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          title="Data até"
        />
        <input
          className="search-input"
          placeholder="Responsável…"
          value={courierFilter}
          onChange={(e) => setCourierFilter(e.target.value)}
        />
        <button type="button" className="btn btn-primary" onClick={() => setShowForm(true)}>
          Nova entrega
        </button>
      </ModuleToolbar>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}

      <div className="split-panels">
        <div className="product-table-wrap">
          <table className="product-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Venda</th>
                <th>Cliente</th>
                <th>Data</th>
                <th>Período</th>
                <th>Responsável</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id} onClick={() => void openDelivery(d.id)} style={{ cursor: 'pointer' }}>
                  <td>{d.id}</td>
                  <td>{d.sale_number || d.sale_id}</td>
                  <td>{d.customer_name || '—'}</td>
                  <td>{d.scheduled_date || '—'}</td>
                  <td>{d.period || '—'}</td>
                  <td>{d.courier_name || '—'}</td>
                  <td>
                    <StatusPill tone={tone(d.status)}>{d.status}</StatusPill>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={7}>Nenhuma entrega.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="side-card">
          {!selected ? (
            <p className="cart-empty">Selecione uma entrega para ver histórico e alterar status.</p>
          ) : (
            <>
              <h3>
                Entrega #{selected.id} · {selected.sale_number}
              </h3>
              <p>
                {selected.customer_name || 'Cliente'} · {selected.phone || selected.whatsapp || '—'}
              </p>
              <p>
                {[selected.address, selected.address_number, selected.neighborhood, selected.city]
                  .filter(Boolean)
                  .join(', ') || 'Endereço não informado'}
              </p>
              <label>
                Novo status
                <select
                  className="field-input"
                  value={selected.status}
                  onChange={(e) => void changeStatus(e.target.value)}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'block', marginTop: '0.5rem' }}>
                Observação da alteração
                <input
                  className="field-input"
                  value={statusNote}
                  onChange={(e) => setStatusNote(e.target.value)}
                />
              </label>
              <h4 style={{ marginTop: '0.75rem' }}>Histórico</h4>
              <ul>
                {(selected.history || []).map((h) => (
                  <li key={h.id}>
                    {h.created_at}: {h.from_status || '—'} → {h.to_status}
                    {h.note ? ` · ${h.note}` : ''}
                    {h.user_name ? ` · ${h.user_name}` : ''}
                  </li>
                ))}
                {(selected.history || []).length === 0 ? <li>Sem histórico.</li> : null}
              </ul>
            </>
          )}
        </div>
      </div>

      {showForm && (
        <div className="modal-backdrop">
          <div className="modal modal-wide">
            <h3>Nova entrega</h3>
            <div className="form-grid">
              <label className="span-2">
                Venda *
                <select
                  className="field-input"
                  value={saleId}
                  onChange={(e) => setSaleId(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">Selecione…</option>
                  {sales.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.sale_number} · {formatBRL(s.total_cents)} · {s.customer_name || 'Sem cliente'}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Data prevista
                <input
                  className="field-input"
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                />
              </label>
              <label>
                Período
                <select className="field-input" value={period} onChange={(e) => setPeriod(e.target.value)}>
                  <option value="manhã">Manhã</option>
                  <option value="tarde">Tarde</option>
                  <option value="noite">Noite</option>
                </select>
              </label>
              <label>
                Responsável
                <input
                  className="field-input"
                  value={courierName}
                  onChange={(e) => setCourierName(e.target.value)}
                />
              </label>
              <label className="span-2">
                Observações
                <input className="field-input" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void submit()}>
                Criar entrega
              </button>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </section>
  );
}
