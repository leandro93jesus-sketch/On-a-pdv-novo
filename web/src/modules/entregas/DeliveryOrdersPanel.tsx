import { useEffect, useRef, useState } from 'react';
import {
  cancelDeliveryOrderApi,
  confirmDeliveryOrderItemManualApi,
  confirmDeliveryOrderPaymentApi,
  createDeliveryOrderApi,
  fetchDeliveryOrderApi,
  fetchDeliveryOrdersApi,
  fetchProducts,
  formatBRL,
  getStoredAuthUser,
  scanDeliveryOrderBarcodeApi,
  updateDeliveryOrderStatusApi,
  type DeliveryOrder,
  type Product,
} from '../../api/client';
import { ModuleToolbar, StatusPill } from '../../components/ModuleChrome';
import { playSoftBeep } from '../../lib/desktopAsync';

function tone(status: string, pay?: string): 'ok' | 'warn' | 'danger' | 'muted' | 'info' {
  if (status === 'cancelado') return 'danger';
  if (pay === 'nao_pago' || pay === 'pix_pendente') return 'warn';
  if (pay === 'pago' || status === 'entregue') return 'ok';
  if (pay === 'parcial') return 'info';
  return 'muted';
}

function checkTone(st?: string): 'ok' | 'warn' | 'danger' | 'muted' | 'info' {
  if (st === 'CONFERIDO') return 'ok';
  if (st === 'PARCIAL') return 'info';
  if (st === 'PENDENTE') return 'warn';
  return 'muted';
}

export default function DeliveryOrdersPanel() {
  const me = getStoredAuthUser();
  const isAdmin = me?.role === 'administrador';
  const scanRef = useRef<HTMLInputElement | null>(null);
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [selected, setSelected] = useState<DeliveryOrder | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanDetail, setScanDetail] = useState<{ name?: string | null; code?: string } | null>(null);
  const [barcode, setBarcode] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const [exceptionReason, setExceptionReason] = useState('');
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
      setScanError(null);
      setScanDetail(null);
      setTimeout(() => scanRef.current?.focus(), 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao abrir pedido');
    }
  }

  async function handleScan(codeRaw?: string) {
    if (!selected) return;
    const code = String(codeRaw ?? barcode).trim();
    if (!code || scanBusy) return;
    setScanBusy(true);
    setScanError(null);
    setScanDetail(null);
    setError(null);
    try {
      const res = await scanDeliveryOrderBarcodeApi(selected.id, code);
      setSelected(res.order);
      setNotice(res.message || 'Unidade conferida');
      if (res.beep) playSoftBeep();
      setBarcode('');
      setTimeout(() => scanRef.current?.focus(), 30);
      await load();
    } catch (e) {
      const err = e as Error & { code?: string; details?: { product_name?: string; barcode?: string } };
      setScanError(err.message || 'PRODUTO NÃO PERTENCE A ESTE PEDIDO');
      setScanDetail({
        name: err.details?.product_name ?? null,
        code: err.details?.barcode || code,
      });
      setBarcode('');
      setTimeout(() => scanRef.current?.focus(), 30);
    } finally {
      setScanBusy(false);
    }
  }

  async function confirmManual(itemId: number) {
    if (!selected) return;
    try {
      const updated = await confirmDeliveryOrderItemManualApi(selected.id, itemId);
      setSelected(updated);
      setNotice('Conferência manual registrada');
      playSoftBeep();
      setTimeout(() => scanRef.current?.focus(), 30);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro na conferência manual');
    }
  }

  async function advanceStatus(status: string, allowUnchecked = false) {
    if (!selected) return;
    try {
      const updated = await updateDeliveryOrderStatusApi(
        selected.id,
        status,
        allowUnchecked ? exceptionReason.trim() : undefined,
        { allow_unchecked: allowUnchecked }
      );
      setSelected(updated);
      setExceptionReason('');
      setNotice(`Status: ${status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao alterar status');
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
      {error && <div className="alert alert-error">{error}</div>}
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

            {selected.status !== 'cancelado' && (
              <div style={{ marginTop: 12, marginBottom: 12 }}>
                <label>
                  Ler código de barras
                  <input
                    ref={scanRef}
                    className="field-input"
                    value={barcode}
                    disabled={scanBusy}
                    placeholder="Escaneie ou digite o código do produto..."
                    onChange={(e) => setBarcode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleScan();
                      }
                    }}
                    autoFocus
                  />
                </label>
              </div>
            )}

            {scanError && (
              <div className="alert alert-error" style={{ marginBottom: 12 }}>
                <strong>{scanError}</strong>
                {scanDetail && (
                  <div style={{ marginTop: 6 }}>
                    {scanDetail.name != null && (
                      <div>
                        Produto encontrado: <strong>{scanDetail.name || '—'}</strong>
                      </div>
                    )}
                    <div>
                      Código: <strong>{scanDetail.code}</strong>
                    </div>
                  </div>
                )}
              </div>
            )}

            <table className="data-table" style={{ marginBottom: 12 }}>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Pedida</th>
                  <th>Conferida</th>
                  <th>Falta</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(selected.items || []).map((it) => (
                  <tr key={it.id}>
                    <td>
                      {it.product_name}
                      <div className="muted-line">{it.product_barcode || it.product_sku || 'sem código'}</div>
                    </td>
                    <td>{it.quantity}</td>
                    <td>{it.checked_qty ?? 0}</td>
                    <td>{it.remaining_qty ?? it.quantity}</td>
                    <td>
                      <StatusPill tone={checkTone(it.check_status)}>
                        {it.check_status || 'PENDENTE'}
                      </StatusPill>
                    </td>
                    <td>
                      {selected.status !== 'cancelado' && it.check_status !== 'CONFERIDO' && (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => void confirmManual(it.id)}
                            title="Conferência manual"
                          >
                            Confirmar manualmente
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

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
              {selected.status !== 'cancelado' && selected.payment_status === 'pago' && (
                <>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void advanceStatus('separado')}
                  >
                    Separado
                  </button>
                  <button
                    type="button"
                    className="btn btn-accent"
                    onClick={() => void advanceStatus('pronto_para_entrega')}
                  >
                    Pronto para entrega
                  </button>
                </>
              )}
            </div>

            {isAdmin &&
              selected.payment_status === 'pago' &&
              !selected.all_items_checked &&
              selected.status !== 'cancelado' && (
                <div style={{ marginTop: 12 }}>
                  <label>
                    Liberação excepcional (admin) — motivo obrigatório
                    <input
                      className="field-input"
                      value={exceptionReason}
                      onChange={(e) => setExceptionReason(e.target.value)}
                      placeholder="Motivo da liberação sem conferência total"
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-danger"
                    style={{ marginTop: 8 }}
                    onClick={() => void advanceStatus('separado', true)}
                  >
                    Liberar excepcional → Separado
                  </button>
                </div>
              )}

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
            <h4>Histórico de conferência</h4>
            <ul>
              {(selected.scans || []).slice(0, 20).map((s) => (
                <li key={s.id}>
                  {s.created_at}: {s.method} · {s.product_name} ×{s.quantity}
                  {s.barcode_read ? ` · cód. ${s.barcode_read}` : ''} · {s.user_name || ''}
                </li>
              ))}
            </ul>
            <h4>Histórico do pedido</h4>
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
