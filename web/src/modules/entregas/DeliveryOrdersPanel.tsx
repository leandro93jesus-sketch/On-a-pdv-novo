import { useEffect, useState } from 'react';
import {
  cancelDeliveryOrderApi,
  confirmDeliveryOrderPaymentApi,
  createDeliveryOrderApi,
  fetchDeliveryOrderApi,
  fetchDeliveryOrdersApi,
  fetchProducts,
  formatBRL,
  type DeliveryOrder,
  type Product,
} from '../../api/client';
import { ModuleToolbar, StatusPill } from '../../components/ModuleChrome';

function tone(status: string, pay?: string): 'ok' | 'warn' | 'danger' | 'muted' | 'info' {
  if (status === 'cancelado') return 'danger';
  if (pay === 'nao_pago' || pay === 'pix_pendente') return 'warn';
  if (pay === 'pago' || status === 'entregue') return 'ok';
  if (pay === 'parcial') return 'info';
  return 'muted';
}

export default function DeliveryOrdersPanel() {
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [selected, setSelected] = useState<DeliveryOrder | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [productId, setProductId] = useState<number | ''>('');
  const [qty, setQty] = useState(1);
  const [payMethod, setPayMethod] = useState('pix');
  const [payAmount, setPayAmount] = useState('');
  const [received, setReceived] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [payFilter, setPayFilter] = useState('');

  async function load() {
    try {
      const [list, prods] = await Promise.all([
        fetchDeliveryOrdersApi({ payment_status: payFilter || undefined }),
        fetchProducts(),
      ]);
      setOrders(list);
      setProducts(prods.filter((p) => p.active !== 0).slice(0, 300));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar pedidos');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payFilter]);

  async function openOrder(id: number) {
    try {
      setSelected(await fetchDeliveryOrderApi(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao abrir pedido');
    }
  }

  async function createOrder() {
    if (!productId) {
      setError('Selecione um produto');
      return;
    }
    try {
      const created = await createDeliveryOrderApi({
        client_request_id: `ui-ord-${Date.now()}`,
        customer_name: customerName.trim() || null,
        phone: phone.trim() || null,
        items: [{ product_id: productId, quantity: Math.max(1, Number(qty) || 1) }],
      });
      setShowForm(false);
      setNotice(`Pedido ${created.order_number} criado — AGUARDANDO PAGAMENTO (não entra no caixa).`);
      await load();
      await openOrder(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao criar pedido');
    }
  }

  async function confirmPay(opts?: { markPixPending?: boolean }) {
    if (!selected) return;
    const due = selected.total_cents - selected.amount_paid_cents;
    const cents = Math.round(Number(String(payAmount).replace(',', '.')) * 100) || due;
    try {
      if (opts?.markPixPending) {
        const updated = await confirmDeliveryOrderPaymentApi(selected.id, {
          mark_pix_pending: true,
        });
        setSelected(updated);
        setNotice('PIX marcado como aguardando confirmação — ainda não entrou no caixa.');
        setShowPay(false);
        await load();
        return;
      }
      const payload: Record<string, unknown> = {
        client_request_id: `ui-pay-${selected.id}-${Date.now()}`,
        payments: [
          {
            method: payMethod,
            amount_cents: cents,
            ...(payMethod === 'dinheiro' && received
              ? { amount_received_cents: Math.round(Number(String(received).replace(',', '.')) * 100) }
              : {}),
          },
        ],
      };
      const updated = await confirmDeliveryOrderPaymentApi(selected.id, payload);
      setSelected(updated);
      setShowPay(false);
      setNotice(
        updated.payment_status === 'pago'
          ? 'Pagamento confirmado. Venda lançada no caixa uma única vez; reserva convertida.'
          : `Pagamento parcial registrado. Pago ${formatBRL(updated.amount_paid_cents)} · saldo ${formatBRL(updated.total_cents - updated.amount_paid_cents)}`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao confirmar pagamento');
    }
  }

  async function cancelOrder() {
    if (!selected || !cancelReason.trim()) {
      setError('Informe o motivo do cancelamento');
      return;
    }
    try {
      const updated = await cancelDeliveryOrderApi(selected.id, cancelReason.trim());
      setSelected(updated);
      setCancelReason('');
      setNotice('Pedido cancelado. Reserva liberada.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao cancelar');
    }
  }

  return (
    <>
      <p className="muted-line" style={{ marginBottom: 8 }}>
        Pedido ≠ venda paga. Enquanto aguarda pagamento: R$ 0,00 no caixa. Documento: PEDIDO — PAGAMENTO
        PENDENTE.
      </p>
      <ModuleToolbar>
        <select className="field-input" value={payFilter} onChange={(e) => setPayFilter(e.target.value)}>
          <option value="">Todos pagamentos</option>
          <option value="nao_pago">Não pago</option>
          <option value="parcial">Parcial</option>
          <option value="pix_pendente">PIX pendente</option>
          <option value="pago">Pago</option>
        </select>
        <button type="button" className="btn btn-primary" onClick={() => setShowForm(true)}>
          Novo pedido
        </button>
      </ModuleToolbar>
      {error && <div className="alert alert-danger">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}

      <div className="split-layout">
        <div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Cliente</th>
                <th>Status</th>
                <th>Pagamento</th>
                <th>Total</th>
                <th>Pago</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} onClick={() => void openOrder(o.id)} style={{ cursor: 'pointer' }}>
                  <td>{o.order_number}</td>
                  <td>{o.customer_name || '—'}</td>
                  <td>
                    <StatusPill tone={tone(o.status, o.payment_status)}>{o.status}</StatusPill>
                  </td>
                  <td>{o.payment_status}</td>
                  <td>{formatBRL(o.total_cents)}</td>
                  <td>{formatBRL(o.amount_paid_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selected && (
          <div className="side-card">
            <h3>
              {selected.order_number}{' '}
              <StatusPill tone={tone(selected.status, selected.payment_status)}>
                {selected.payment_status === 'nao_pago' || selected.payment_status === 'pix_pendente'
                  ? 'PEDIDO — PAGAMENTO PENDENTE'
                  : selected.payment_status}
              </StatusPill>
            </h3>
            <p>
              Cliente: {selected.customer_name || '—'} · Total {formatBRL(selected.total_cents)} · Pago{' '}
              {formatBRL(selected.amount_paid_cents)} · Saldo{' '}
              {formatBRL(selected.total_cents - selected.amount_paid_cents)}
            </p>
            <ul>
              {(selected.items || []).map((it) => (
                <li key={it.id}>
                  {it.product_name} × {it.quantity} = {formatBRL(it.line_total_cents)}
                </li>
              ))}
            </ul>
            {(selected.reservations || []).length > 0 && (
              <p className="muted-line">
                Reservas:{' '}
                {selected.reservations!.map((r) => `#${r.product_id}:${r.quantity}(${r.status})`).join(', ')}
              </p>
            )}
            <div className="modal-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
              {selected.status !== 'cancelado' && selected.payment_status !== 'pago' && (
                <>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      setPayAmount(
                        ((selected.total_cents - selected.amount_paid_cents) / 100).toFixed(2)
                      );
                      setShowPay(true);
                    }}
                  >
                    Confirmar pagamento
                  </button>
                  <button
                    type="button"
                    className="btn btn-accent"
                    onClick={() => void confirmPay({ markPixPending: true })}
                  >
                    Aguardando confirmação PIX
                  </button>
                </>
              )}
            </div>
            {selected.payment_status !== 'pago' && selected.status !== 'cancelado' && (
              <div style={{ marginTop: 12 }}>
                <label>
                  Cancelar pedido (libera reserva)
                  <input
                    className="field-input"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="Motivo obrigatório"
                  />
                </label>
                <button type="button" className="btn btn-danger" style={{ marginTop: 8 }} onClick={() => void cancelOrder()}>
                  Cancelar pedido
                </button>
              </div>
            )}
            <h4>Histórico</h4>
            <ul>
              {(selected.history || []).map((h) => (
                <li key={h.id}>
                  {h.created_at}: {h.to_status} {h.note ? `— ${h.note}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {showForm && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h2>Novo pedido (aguardando pagamento)</h2>
            <div className="form-grid">
              <label>
                Cliente
                <input className="field-input" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
              </label>
              <label>
                Telefone
                <input className="field-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </label>
              <label className="span-2">
                Produto
                <select
                  className="field-input"
                  value={productId}
                  onChange={(e) => setProductId(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">— selecione —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · est. {p.stock_qty} · {formatBRL(p.price_cents)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Quantidade
                <input
                  className="field-input"
                  type="number"
                  min={1}
                  value={qty}
                  onChange={(e) => setQty(Number(e.target.value) || 1)}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>
                Voltar
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void createOrder()}>
                Criar pedido
              </button>
            </div>
          </div>
        </div>
      )}

      {showPay && selected && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h2>Confirmar pagamento</h2>
            <p>
              Pedido {selected.order_number} · Cliente {selected.customer_name || '—'} · Total{' '}
              {formatBRL(selected.total_cents)} · Saldo{' '}
              {formatBRL(selected.total_cents - selected.amount_paid_cents)}
            </p>
            <div className="form-grid">
              <label>
                Forma
                <select className="field-input" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                  <option value="dinheiro">Dinheiro</option>
                  <option value="pix">Pix</option>
                  <option value="cartao">Cartão</option>
                  <option value="crediario">Crediário</option>
                </select>
              </label>
              <label>
                Valor (R$)
                <input className="field-input" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
              </label>
              {payMethod === 'dinheiro' && (
                <label>
                  Valor recebido
                  <input className="field-input" value={received} onChange={(e) => setReceived(e.target.value)} />
                </label>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowPay(false)}>
                Voltar
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void confirmPay()}>
                Confirmar pagamento
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
