import { useEffect, useRef, useState } from 'react';
import {
  cancelDeliveryOrderApi,
  confirmDeliveryOrderItemManualApi,
  confirmDeliveryOrderPaymentApi,
  createDeliveryOrderApi,
  fetchCustomers,
  fetchDeliveryOrderApi,
  fetchDeliveryOrdersApi,
  fetchProducts,
  formatBRL,
  getStoredAuthUser,
  scanDeliveryOrderBarcodeApi,
  updateDeliveryOrderStatusApi,
  type Customer,
  type DeliveryOrder,
  type Product,
} from '../../api/client';
import { ModuleToolbar, StatusPill } from '../../components/ModuleChrome';
import { playSoftBeep } from '../../lib/desktopAsync';

type CartLine = {
  key: string;
  product_id: number;
  name: string;
  barcode?: string | null;
  unit_price_cents: number;
  quantity: number;
};

function tone(status: string, pay?: string): 'ok' | 'warn' | 'danger' | 'muted' | 'info' {
  if (status === 'cancelado') return 'danger';
  if (pay === 'nao_pago' || pay === 'pix_pendente' || pay === 'pagamento_na_entrega') return 'warn';
  if (pay === 'pago' || status === 'entregue') return 'ok';
  if (pay === 'parcial') return 'info';
  return 'muted';
}

function statusLabel(o: DeliveryOrder): string {
  if (o.status === 'cancelado') return 'CANCELADO';
  if (o.payment_status === 'pago') return 'PAGAMENTO CONFIRMADO';
  if (o.payment_status === 'pix_pendente') return 'AGUARDANDO CONFIRMAÇÃO DO PIX';
  if (o.payment_status === 'pagamento_na_entrega') return 'PAGAMENTO NA ENTREGA';
  if (o.payment_status === 'parcial') return 'PAGAMENTO PARCIAL';
  if (o.status === 'aguardando_pagamento' || o.payment_status === 'nao_pago') {
    return 'AGUARDANDO PAGAMENTO';
  }
  return String(o.status || '').replaceAll('_', ' ').toUpperCase();
}

function formatAddress(o: DeliveryOrder): string {
  const parts = [
    o.address,
    o.address_number,
    o.neighborhood,
    o.city && o.state ? `${o.city}/${o.state}` : o.city || o.state,
    o.zip_code,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : '—';
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  try {
    const d = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString('pt-BR');
  } catch {
    return value;
  }
}

async function resolveProduct(query: string): Promise<Product | null> {
  const q = query.trim();
  if (!q) return null;
  const byBarcode = await fetchProducts({ barcode: q });
  const activeBarcode = byBarcode.filter((p) => p.active !== 0);
  if (activeBarcode[0]) return activeBarcode[0];

  const byQ = (await fetchProducts({ q })).filter((p) => p.active !== 0);
  const exact = byQ.find(
    (p) =>
      (p.barcode && p.barcode === q) ||
      (p.sku && p.sku.toLowerCase() === q.toLowerCase()) ||
      p.name.toLowerCase() === q.toLowerCase()
  );
  if (exact) return exact;
  if (byQ.length === 1) return byQ[0];
  return null;
}

export default function DeliveryOrdersPanel() {
  const me = getStoredAuthUser();
  const isAdmin = me?.role === 'administrador';
  const scanRef = useRef<HTMLInputElement | null>(null);
  const draftScanRef = useRef<HTMLInputElement | null>(null);

  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [selected, setSelected] = useState<DeliveryOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [payFilter, setPayFilter] = useState('');
  const [view, setView] = useState<'lista' | 'nova'>('lista');

  // Nova entrega (carrinho local)
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerOptions, setCustomerOptions] = useState<Customer[]>([]);
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [draftScan, setDraftScan] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [scanBusy, setScanBusy] = useState(false);
  const [productNotFound, setProductNotFound] = useState(false);
  const [creating, setCreating] = useState(false);

  // Pagamento / detalhe
  const [showPay, setShowPay] = useState(false);
  const [payMethod, setPayMethod] = useState('dinheiro');
  const [payAmount, setPayAmount] = useState('');
  const [received, setReceived] = useState('');
  const [mistoSecond, setMistoSecond] = useState('pix');
  const [mistoAmount2, setMistoAmount2] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [alreadyPaidInfo, setAlreadyPaidInfo] = useState<{
    paid_at?: string | null;
    operator?: string | null;
    payment_method?: string | null;
  } | null>(null);

  // Conferência pós-pagamento (fluxo existente, secundário)
  const [sepBarcode, setSepBarcode] = useState('');
  const [sepBusy, setSepBusy] = useState(false);
  const [exceptionReason, setExceptionReason] = useState('');

  const cartTotal = cart.reduce((s, l) => s + l.unit_price_cents * l.quantity, 0);

  async function load() {
    try {
      const list = await fetchDeliveryOrdersApi({ payment_status: payFilter || undefined });
      setOrders(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar pedidos');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payFilter]);

  useEffect(() => {
    if (view !== 'nova') return;
    const t = window.setTimeout(async () => {
      try {
        setCustomerOptions(await fetchCustomers({ q: customerQuery.trim() || undefined }));
      } catch {
        setCustomerOptions([]);
      }
    }, 180);
    return () => window.clearTimeout(t);
  }, [customerQuery, view]);

  useEffect(() => {
    if (view === 'nova') {
      setTimeout(() => draftScanRef.current?.focus(), 50);
    }
  }, [view]);

  function resetNova() {
    setCustomer(null);
    setCustomerQuery('');
    setAddress('');
    setPhone('');
    setDraftScan('');
    setCart([]);
    setProductNotFound(false);
    setCreating(false);
  }

  function openNova() {
    resetNova();
    setSelected(null);
    setView('nova');
    setError(null);
    setNotice(null);
    setAlreadyPaidInfo(null);
  }

  async function openOrder(id: number) {
    try {
      setView('lista');
      setSelected(await fetchDeliveryOrderApi(id));
      setAlreadyPaidInfo(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao abrir pedido');
    }
  }

  function addProductToCart(product: Product) {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.product_id === product.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [
        ...prev,
        {
          key: `p-${product.id}`,
          product_id: product.id,
          name: product.name,
          barcode: product.barcode,
          unit_price_cents: Number(product.price_cents) || 0,
          quantity: 1,
        },
      ];
    });
  }

  async function handleDraftScan(codeRaw?: string) {
    const code = String(codeRaw ?? draftScan).trim();
    if (!code || scanBusy) return;
    setScanBusy(true);
    setProductNotFound(false);
    setError(null);
    try {
      const product = await resolveProduct(code);
      if (!product) {
        setProductNotFound(true);
        setDraftScan('');
        setTimeout(() => draftScanRef.current?.focus(), 30);
        return;
      }
      addProductToCart(product);
      playSoftBeep();
      setDraftScan('');
      setTimeout(() => draftScanRef.current?.focus(), 30);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao buscar produto');
      setDraftScan('');
      setTimeout(() => draftScanRef.current?.focus(), 30);
    } finally {
      setScanBusy(false);
    }
  }

  function setLineQty(key: string, quantity: number) {
    const q = Math.max(1, Math.floor(Number(quantity) || 1));
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, quantity: q } : l)));
  }

  function bumpQty(key: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => {
          if (l.key !== key) return l;
          return { ...l, quantity: Math.max(1, l.quantity + delta) };
        })
        .filter((l) => l.quantity > 0)
    );
  }

  function removeLine(key: string) {
    setCart((prev) => prev.filter((l) => l.key !== key));
  }

  async function createOrder() {
    if (!cart.length) {
      setError('Passe ao menos um produto no leitor para montar o pedido');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await createDeliveryOrderApi({
        client_request_id: `ui-ord-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        customer_id: customer?.id ?? null,
        customer_name: customer?.name || customerQuery.trim() || null,
        phone: phone.trim() || customer?.phone || null,
        address: address.trim() || customer?.address || null,
        address_number: customer?.address_number || null,
        neighborhood: customer?.neighborhood || null,
        city: customer?.city || null,
        state: customer?.state || null,
        zip_code: customer?.zip_code || null,
        items: cart.map((l) => ({
          product_id: l.product_id,
          quantity: l.quantity,
          unit_price_cents: l.unit_price_cents,
        })),
      });
      setNotice(
        `Pedido ${created.order_number} criado — STATUS: AGUARDANDO PAGAMENTO. Estoque reservado. Não entrou no caixa.`
      );
      resetNova();
      setView('lista');
      await load();
      await openOrder(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao criar pedido');
    } finally {
      setCreating(false);
    }
  }

  async function confirmPay(opts?: { markPixPending?: boolean; markCod?: boolean }) {
    if (!selected) return;
    setAlreadyPaidInfo(null);
    try {
      if (opts?.markPixPending) {
        const updated = await confirmDeliveryOrderPaymentApi(selected.id, {
          mark_pix_pending: true,
        });
        setSelected(updated);
        setShowPay(false);
        setNotice('AGUARDANDO CONFIRMAÇÃO DO PIX — ainda não entrou no caixa.');
        await load();
        return;
      }
      if (opts?.markCod) {
        const updated = await confirmDeliveryOrderPaymentApi(selected.id, {
          mark_pagamento_na_entrega: true,
        });
        setSelected(updated);
        setShowPay(false);
        setNotice('PAGAMENTO NA ENTREGA — pedido continua pendente financeiramente.');
        await load();
        return;
      }

      const due = selected.total_cents - selected.amount_paid_cents;
      const cents = Math.round(Number(String(payAmount).replace(',', '.')) * 100) || due;
      let payments: Array<Record<string, unknown>>;

      if (payMethod === 'misto') {
        const a1 = Math.round(Number(String(payAmount).replace(',', '.')) * 100);
        const a2 = Math.round(Number(String(mistoAmount2).replace(',', '.')) * 100);
        if (!a1 || !a2 || a1 + a2 !== due) {
          setError('No pagamento misto, informe dois valores que somem o saldo do pedido');
          return;
        }
        payments = [
          { method: 'dinheiro', amount_cents: a1, amount_received_cents: a1 },
          { method: mistoSecond, amount_cents: a2 },
        ];
      } else {
        payments = [
          {
            method: payMethod,
            amount_cents: cents,
            ...(payMethod === 'dinheiro' && received
              ? { amount_received_cents: Math.round(Number(String(received).replace(',', '.')) * 100) }
              : {}),
          },
        ];
      }

      const updated = await confirmDeliveryOrderPaymentApi(selected.id, {
        client_request_id: `ui-pay-${selected.id}-${Date.now()}`,
        payments,
      });
      setSelected(updated);
      setShowPay(false);
      setNotice(
        updated.payment_status === 'pago'
          ? 'PAGAMENTO CONFIRMADO. Valor lançado no caixa. Reserva convertida em baixa.'
          : `Pagamento parcial. Pago ${formatBRL(updated.amount_paid_cents)} · saldo ${formatBRL(updated.total_cents - updated.amount_paid_cents)}`
      );
      await load();
    } catch (e) {
      const err = e as Error & {
        code?: string;
        details?: { paid_at?: string; operator?: string; payment_method?: string };
      };
      if (err.code === 'ORDER_ALREADY_PAID') {
        setAlreadyPaidInfo({
          paid_at: err.details?.paid_at,
          operator: err.details?.operator,
          payment_method: err.details?.payment_method,
        });
        setError('PAGAMENTO JÁ CONFIRMADO');
        setShowPay(false);
        await openOrder(selected.id);
        await load();
        return;
      }
      setError(err.message || 'Erro ao confirmar pagamento');
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
      setNotice('Pedido cancelado. Reserva liberada. Sem lançamento no caixa.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao cancelar');
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

  async function handleSepScan(codeRaw?: string) {
    if (!selected) return;
    const code = String(codeRaw ?? sepBarcode).trim();
    if (!code || sepBusy) return;
    setSepBusy(true);
    try {
      const res = await scanDeliveryOrderBarcodeApi(selected.id, code);
      setSelected(res.order);
      setNotice(res.message || 'Unidade conferida');
      if (res.beep) playSoftBeep();
      setSepBarcode('');
      setTimeout(() => scanRef.current?.focus(), 30);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro na conferência');
      setSepBarcode('');
      setTimeout(() => scanRef.current?.focus(), 30);
    } finally {
      setSepBusy(false);
    }
  }

  async function confirmManual(itemId: number) {
    if (!selected) return;
    try {
      const updated = await confirmDeliveryOrderItemManualApi(selected.id, itemId);
      setSelected(updated);
      setNotice('Conferência manual registrada');
      playSoftBeep();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro na conferência manual');
    }
  }

  const unpaid =
    selected &&
    selected.status !== 'cancelado' &&
    selected.payment_status !== 'pago';
  const paidConfirmed = selected?.payment_status === 'pago';

  return (
    <>
      <p className="muted-line" style={{ marginBottom: 8 }}>
        Fluxo: Nova entrega → passar produtos no leitor → criar pedido → AGUARDANDO PAGAMENTO → confirmar
        recebimento → entra no caixa. Passar produto ou criar pedido não é pagamento.
      </p>

      <ModuleToolbar>
        <select className="field-input" value={payFilter} onChange={(e) => setPayFilter(e.target.value)}>
          <option value="">Todos pagamentos</option>
          <option value="nao_pago">Aguardando pagamento</option>
          <option value="pagamento_na_entrega">Pagamento na entrega</option>
          <option value="pix_pendente">PIX pendente</option>
          <option value="parcial">Parcial</option>
          <option value="pago">Pago</option>
        </select>
        <button type="button" className="btn btn-ghost" onClick={() => { setView('lista'); void load(); }}>
          Pedidos
        </button>
        <button type="button" className="btn btn-primary" onClick={openNova}>
          Nova entrega
        </button>
      </ModuleToolbar>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}
      {alreadyPaidInfo && (
        <div className="alert alert-error">
          <strong>PAGAMENTO JÁ CONFIRMADO</strong>
          <div>Data/Hora: {formatDateTime(alreadyPaidInfo.paid_at)}</div>
          <div>Operador: {alreadyPaidInfo.operator || '—'}</div>
          <div>Forma: {alreadyPaidInfo.payment_method || '—'}</div>
        </div>
      )}

      {view === 'nova' && (
        <div className="side-card" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>NOVA ENTREGA</h2>

          <div className="form-grid">
            <label className="span-2">
              Cliente
              <input
                className="field-input"
                value={customer ? customer.name : customerQuery}
                onChange={(e) => {
                  setCustomer(null);
                  setCustomerQuery(e.target.value);
                }}
                placeholder="Selecionar cliente (nome)"
                list="entrega-clientes"
              />
              <datalist id="entrega-clientes">
                {customerOptions.map((c) => (
                  <option key={c.id} value={c.name} />
                ))}
              </datalist>
              {!customer && customerOptions.length > 0 && customerQuery.trim() && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {customerOptions.slice(0, 6).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => {
                        setCustomer(c);
                        setCustomerQuery(c.name);
                        setPhone(c.phone || '');
                        const addr = [c.address, c.address_number, c.neighborhood, c.city]
                          .filter(Boolean)
                          .join(', ');
                        setAddress(addr);
                      }}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </label>
            <label className="span-2">
              Endereço
              <input
                className="field-input"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Endereço da entrega"
              />
            </label>
            <label>
              Telefone
              <input
                className="field-input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Telefone"
              />
            </label>
          </div>

          <label style={{ display: 'block', marginTop: 16, marginBottom: 8 }}>
            <strong>LER CÓDIGO DE BARRAS / BUSCAR PRODUTO</strong>
            <input
              ref={draftScanRef}
              className="field-input"
              style={{ fontSize: 18, padding: '14px 12px', marginTop: 6 }}
              value={draftScan}
              disabled={scanBusy || creating}
              placeholder="Passe o produto no leitor ou digite nome/código..."
              onChange={(e) => {
                setDraftScan(e.target.value);
                setProductNotFound(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleDraftScan();
                }
              }}
              autoFocus
            />
          </label>

          {productNotFound && (
            <div className="alert alert-error" style={{ marginBottom: 12 }}>
              <strong>PRODUTO NÃO ENCONTRADO</strong>
              <div>Não foi criado produto automaticamente. Passe outro código.</div>
            </div>
          )}

          <h3>Itens da entrega</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>PRODUTO</th>
                <th>QUANTIDADE</th>
                <th>VALOR UNITÁRIO</th>
                <th>SUBTOTAL</th>
                <th>REMOVER</th>
              </tr>
            </thead>
            <tbody>
              {cart.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted-line">
                    Nenhum produto. Use o leitor para montar o pedido.
                  </td>
                </tr>
              )}
              {cart.map((line) => (
                <tr key={line.key}>
                  <td>
                    {line.name}
                    {line.barcode ? <div className="muted-line">{line.barcode}</div> : null}
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <button type="button" className="btn btn-ghost" onClick={() => bumpQty(line.key, -1)}>
                        −
                      </button>
                      <input
                        className="field-input"
                        style={{ width: 64, textAlign: 'center' }}
                        type="number"
                        min={1}
                        value={line.quantity}
                        onChange={(e) => setLineQty(line.key, Number(e.target.value))}
                      />
                      <button type="button" className="btn btn-ghost" onClick={() => bumpQty(line.key, 1)}>
                        +
                      </button>
                    </div>
                  </td>
                  <td>{formatBRL(line.unit_price_cents)}</td>
                  <td>{formatBRL(line.unit_price_cents * line.quantity)}</td>
                  <td>
                    <button type="button" className="btn btn-danger" onClick={() => removeLine(line.key)}>
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p style={{ fontSize: 18, marginTop: 12 }}>
            <strong>TOTAL DO PEDIDO:</strong> {formatBRL(cartTotal)}
          </p>

          <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                resetNova();
                setView('lista');
              }}
            >
              Voltar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={creating || cart.length === 0}
              onClick={() => void createOrder()}
            >
              CRIAR PEDIDO DE ENTREGA
            </button>
          </div>
        </div>
      )}

      {view === 'lista' && (
        <div className="split-layout">
          <div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>PEDIDO</th>
                  <th>CLIENTE</th>
                  <th>TOTAL</th>
                  <th>STATUS</th>
                  <th>DATA</th>
                  <th>AÇÕES</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => void openOrder(o.id)}>
                    <td>{o.order_number}</td>
                    <td>{o.customer_name || '—'}</td>
                    <td>{formatBRL(o.total_cents)}</td>
                    <td>
                      <StatusPill tone={tone(o.status, o.payment_status)}>{statusLabel(o)}</StatusPill>
                    </td>
                    <td>{formatDateTime(o.created_at)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          void openOrder(o.id);
                        }}
                      >
                        Abrir
                      </button>
                    </td>
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
                  {statusLabel(selected)}
                </StatusPill>
              </h3>

              <p>
                <strong>STATUS:</strong> {statusLabel(selected)}
              </p>
              <p>
                <strong>Cliente:</strong> {selected.customer_name || '—'}
              </p>
              <p>
                <strong>Endereço:</strong> {formatAddress(selected)}
              </p>
              <p>
                <strong>Telefone:</strong> {selected.phone || '—'}
              </p>
              <p>
                <strong>Total:</strong> {formatBRL(selected.total_cents)} ·{' '}
                <strong>Pago:</strong> {formatBRL(selected.amount_paid_cents)}
              </p>

              {paidConfirmed && (
                <div className="alert alert-ok" style={{ marginBottom: 12 }}>
                  <strong>PAGAMENTO CONFIRMADO</strong>
                  <div>Data: {formatDateTime(selected.paid_at)}</div>
                  <div>
                    Forma:{' '}
                    {(selected.payments || []).map((p) => p.method).join(' + ') || '—'}
                  </div>
                  <div>
                    Operador:{' '}
                    {(selected.payments || []).slice(-1)[0]?.user_name || selected.created_by || '—'}
                  </div>
                </div>
              )}

              <table className="data-table" style={{ marginBottom: 12 }}>
                <thead>
                  <tr>
                    <th>PRODUTO</th>
                    <th>QTD</th>
                    <th>UNIT.</th>
                    <th>SUBTOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {(selected.items || []).map((it) => (
                    <tr key={it.id}>
                      <td>{it.product_name}</td>
                      <td>{it.quantity}</td>
                      <td>{formatBRL(it.unit_price_cents)}</td>
                      <td>{formatBRL(it.line_total_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {(selected.reservations || []).some((r) => r.status === 'ativa') && (
                <p className="muted-line">
                  Estoque reservado (ainda não é venda):{' '}
                  {selected
                    .reservations!.filter((r) => r.status === 'ativa')
                    .map((r) => `#${r.product_id}×${r.quantity}`)
                    .join(', ')}
                </p>
              )}

              <div className="modal-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
                {unpaid && selected.payment_status !== 'pix_pendente' && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      setPayAmount(
                        ((selected.total_cents - selected.amount_paid_cents) / 100).toFixed(2)
                      );
                      setReceived('');
                      setPayMethod('dinheiro');
                      setShowPay(true);
                    }}
                  >
                    CONFIRMAR PAGAMENTO
                  </button>
                )}

                {unpaid && selected.payment_status === 'pix_pendente' && (
                  <>
                    <div className="alert alert-error" style={{ width: '100%' }}>
                      AGUARDANDO CONFIRMAÇÃO DO PIX — sem entrada no caixa até confirmar.
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        setPayMethod('pix');
                        setPayAmount(
                          ((selected.total_cents - selected.amount_paid_cents) / 100).toFixed(2)
                        );
                        setShowPay(true);
                      }}
                    >
                      CONFIRMAR PIX RECEBIDO
                    </button>
                  </>
                )}

                {unpaid && selected.payment_status === 'pagamento_na_entrega' && (
                  <button
                    type="button"
                    className="btn btn-accent"
                    onClick={() => {
                      setPayAmount(
                        ((selected.total_cents - selected.amount_paid_cents) / 100).toFixed(2)
                      );
                      setPayMethod('dinheiro');
                      setShowPay(true);
                    }}
                  >
                    CONFIRMAR RECEBIMENTO
                  </button>
                )}

                {unpaid &&
                  selected.payment_status !== 'pagamento_na_entrega' &&
                  selected.payment_status !== 'pix_pendente' && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => void confirmPay({ markCod: true })}
                    >
                      PAGAMENTO NA ENTREGA
                    </button>
                  )}

                {paidConfirmed && (
                  <>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void advanceStatus('em_separacao')}
                    >
                      EM SEPARAÇÃO
                    </button>
                    <button
                      type="button"
                      className="btn btn-accent"
                      onClick={() => void advanceStatus('pronto_para_entrega')}
                    >
                      PRONTO PARA ENTREGA
                    </button>
                    <button
                      type="button"
                      className="btn btn-accent"
                      onClick={() => void advanceStatus('saiu_para_entrega')}
                    >
                      SAIU PARA ENTREGA
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void advanceStatus('entregue')}
                    >
                      ENTREGUE
                    </button>
                  </>
                )}
              </div>

              {paidConfirmed && selected.status !== 'cancelado' && (
                <div style={{ marginTop: 16 }}>
                  <h4>Conferência na separação (opcional)</h4>
                  <input
                    ref={scanRef}
                    className="field-input"
                    value={sepBarcode}
                    disabled={sepBusy}
                    placeholder="Conferir item do pedido..."
                    onChange={(e) => setSepBarcode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleSepScan();
                      }
                    }}
                  />
                  <table className="data-table" style={{ marginTop: 8 }}>
                    <thead>
                      <tr>
                        <th>Produto</th>
                        <th>Pedida</th>
                        <th>Conferida</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selected.items || []).map((it) => (
                        <tr key={it.id}>
                          <td>{it.product_name}</td>
                          <td>{it.quantity}</td>
                          <td>{it.checked_qty ?? 0}</td>
                          <td>
                            {it.check_status !== 'CONFERIDO' && (
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => void confirmManual(it.id)}
                              >
                                Manual
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {isAdmin && !selected.all_items_checked && (
                    <div style={{ marginTop: 8 }}>
                      <input
                        className="field-input"
                        value={exceptionReason}
                        onChange={(e) => setExceptionReason(e.target.value)}
                        placeholder="Motivo liberação excepcional (admin)"
                      />
                      <button
                        type="button"
                        className="btn btn-danger"
                        style={{ marginTop: 8 }}
                        onClick={() => void advanceStatus('separado', true)}
                      >
                        Liberar excepcional
                      </button>
                    </div>
                  )}
                </div>
              )}

              {unpaid && (
                <div style={{ marginTop: 12 }}>
                  <label>
                    Cancelar pedido (libera reserva, sem caixa)
                    <input
                      className="field-input"
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      placeholder="Motivo obrigatório"
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-danger"
                    style={{ marginTop: 8 }}
                    onClick={() => void cancelOrder()}
                  >
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
      )}

      {showPay && selected && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h2>FORMA DE PAGAMENTO</h2>
            <p>
              Pedido {selected.order_number} · Cliente {selected.customer_name || '—'} · Saldo{' '}
              {formatBRL(selected.total_cents - selected.amount_paid_cents)}
            </p>
            <div className="form-grid">
              <label>
                Forma
                <select
                  className="field-input"
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value)}
                >
                  <option value="dinheiro">DINHEIRO</option>
                  <option value="pix">PIX</option>
                  <option value="cartao">CARTÃO</option>
                  <option value="crediario">CREDIÁRIO</option>
                  <option value="misto">MISTO</option>
                </select>
              </label>
              <label>
                Valor (R$)
                <input
                  className="field-input"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                />
              </label>
              {payMethod === 'dinheiro' && (
                <label>
                  Valor recebido
                  <input
                    className="field-input"
                    value={received}
                    onChange={(e) => setReceived(e.target.value)}
                  />
                </label>
              )}
              {payMethod === 'misto' && (
                <>
                  <label>
                    2ª forma
                    <select
                      className="field-input"
                      value={mistoSecond}
                      onChange={(e) => setMistoSecond(e.target.value)}
                    >
                      <option value="pix">PIX</option>
                      <option value="cartao">CARTÃO</option>
                      <option value="crediario">CREDIÁRIO</option>
                    </select>
                  </label>
                  <label>
                    Valor 2ª forma (R$)
                    <input
                      className="field-input"
                      value={mistoAmount2}
                      onChange={(e) => setMistoAmount2(e.target.value)}
                    />
                  </label>
                </>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowPay(false)}>
                Voltar
              </button>
              {payMethod === 'pix' && selected.payment_status !== 'pix_pendente' && (
                <button
                  type="button"
                  className="btn btn-accent"
                  onClick={() => void confirmPay({ markPixPending: true })}
                >
                  Aguardar confirmação PIX
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void confirmPay()}
              >
                {selected.payment_status === 'pix_pendente'
                  ? 'CONFIRMAR PIX RECEBIDO'
                  : selected.payment_status === 'pagamento_na_entrega'
                    ? 'CONFIRMAR RECEBIMENTO'
                    : 'CONFIRMAR PAGAMENTO'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
