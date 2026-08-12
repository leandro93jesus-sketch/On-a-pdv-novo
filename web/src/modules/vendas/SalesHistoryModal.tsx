import { useEffect, useState } from 'react';
import {
  fetchSale,
  fetchSales,
  formatBRL,
  paymentLabel,
  type Sale,
} from '../../api/client';

type Props = {
  onClose: () => void;
  onOpenSale: (sale: Sale) => void;
};

type Period = '' | 'today' | 'yesterday' | 'last7' | 'month' | 'custom';

export default function SalesHistoryModal({ onClose, onOpenSale }: Props) {
  const [sales, setSales] = useState<Sale[]>([]);
  const [q, setQ] = useState('');
  const [period, setPeriod] = useState<Period>('today');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [payment, setPayment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Sale | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const list = await fetchSales({
        limit: 100,
        q: q.trim() || undefined,
        period: period && period !== 'custom' ? period : undefined,
        from: period === 'custom' && from ? from : undefined,
        to: period === 'custom' && to ? to : undefined,
        payment_method: payment || undefined,
      });
      setSales(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar histórico');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, period, from, to, payment]);

  async function openDetail(id: number) {
    try {
      const sale = await fetchSale(id);
      setDetail(sale);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao abrir venda');
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Histórico de vendas">
      <div className="modal modal-wide" style={{ width: 'min(980px, 100%)' }}>
        <h3>Histórico de vendas</h3>
        <p className="muted-line">
          Somente consulta. Use Visualizar PDF / Imprimir / Enviar PDF no WhatsApp no comprovante.
        </p>
        <div className="form-grid" style={{ marginBottom: 12 }}>
          <label className="span-2">
            Busca (número, cliente, telefone, produto, valor…)
            <input className="field-input" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <label>
            Período
            <select
              className="field-input"
              value={period}
              onChange={(e) => setPeriod(e.target.value as Period)}
            >
              <option value="">Todos</option>
              <option value="today">Hoje</option>
              <option value="yesterday">Ontem</option>
              <option value="last7">Últimos 7 dias</option>
              <option value="month">Este mês</option>
              <option value="custom">Período personalizado</option>
            </select>
          </label>
          <label>
            Pagamento
            <select
              className="field-input"
              value={payment}
              onChange={(e) => setPayment(e.target.value)}
            >
              <option value="">Todas</option>
              <option value="dinheiro">Dinheiro</option>
              <option value="pix">Pix</option>
              <option value="cartao">Cartão</option>
              <option value="crediario">Crediário</option>
              <option value="misto">Misto</option>
            </select>
          </label>
          {period === 'custom' && (
            <>
              <label>
                De
                <input
                  className="field-input"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label>
                Até
                <input
                  className="field-input"
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
            </>
          )}
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="product-table-wrap" style={{ maxHeight: 320, overflow: 'auto' }}>
          <table className="product-table">
            <thead>
              <tr>
                <th>Número</th>
                <th>Data/hora</th>
                <th>Cliente</th>
                <th>Pagamento</th>
                <th>Total</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.id}>
                  <td>{s.sale_number}</td>
                  <td>{s.created_at}</td>
                  <td>{s.customer_name || '—'}</td>
                  <td>{paymentLabel(s.payment_method)}</td>
                  <td>{formatBRL(s.total_cents)}</td>
                  <td>{s.status === 'cancelled' ? 'Cancelada' : 'Concluída'}</td>
                  <td className="row-actions">
                    <button type="button" className="btn btn-ghost" onClick={() => void openDetail(s.id)}>
                      Detalhes
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() =>
                        void fetchSale(s.id).then((sale) => {
                          onOpenSale(sale);
                        })
                      }
                    >
                      Visualizar PDF
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() =>
                        void fetchSale(s.id).then((sale) => {
                          onOpenSale(sale);
                        })
                      }
                    >
                      Imprimir / WhatsApp
                    </button>
                  </td>
                </tr>
              ))}
              {!busy && sales.length === 0 && (
                <tr>
                  <td colSpan={7}>Nenhuma venda encontrada.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {detail && (
          <div className="side-card" style={{ marginTop: 12 }}>
            <h3>Detalhes — {detail.sale_number}</h3>
            <pre className="code-block" style={{ maxHeight: 220, overflow: 'auto' }}>
              {JSON.stringify(
                {
                  numero: detail.sale_number,
                  data: detail.created_at,
                  cliente: detail.customer,
                  status: detail.status,
                  itens: detail.items,
                  pagamentos: detail.payments,
                  troco: detail.change_cents,
                  recebido: detail.amount_received_cents,
                  desconto: detail.discount_cents,
                  total: detail.total_cents,
                },
                null,
                2
              )}
            </pre>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setDetail(null)}>
                Fechar detalhes
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  onOpenSale(detail);
                }}
              >
                Visualizar PDF
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  onOpenSale(detail);
                }}
              >
                Imprimir / Enviar PDF no WhatsApp
              </button>
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
