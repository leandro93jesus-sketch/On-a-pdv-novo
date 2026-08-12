import { useEffect, useRef, useState } from 'react';
import {
  cancelDeliveryOrderApi,
  confirmDeliveryOrderItemManualApi,
  confirmDeliveryOrderPaymentApi,
  createDeliveryOrderApi,
  deliveryOrderWhatsappShareApi,
  fetchCustomers,
  fetchDeliveryOrderApi,
  fetchDeliveryOrdersApi,
  fetchProducts,
  formatBRL,
  generateDeliveryOrderPdfApi,
  getStoredAuthUser,
  scanDeliveryOrderBarcodeApi,
  updateDeliveryOrderApi,
  updateDeliveryOrderStatusApi,
  type Customer,
  type DeliveryOrder,
  type Product,
} from '../../api/client';
import { ModuleToolbar, StatusPill } from '../../components/ModuleChrome';
import { playSoftBeep } from '../../lib/desktopAsync';
import DeliveryAddressForm, {
  emptyDeliveryAddress,
  type DeliveryAddressFormValue,
} from './DeliveryAddressForm';
import { isDeliveryAddressComplete } from './deliveryAddress';
import DeliveryRoutePanel from './DeliveryRoutePanel';
import CardPaymentModal, { type CardType } from '../vendas/CardPaymentModal';

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
  const [listFilter, setListFilter] = useState('');
  const [view, setView] = useState<'lista' | 'nova'>('lista');
  const [showEdit, setShowEdit] = useState(false);
  const [editAddr, setEditAddr] = useState<DeliveryAddressFormValue>(emptyDeliveryAddress());
  const [editItems, setEditItems] = useState<
    Array<{ product_id: number | null; name: string; quantity: number; unit_price_cents: number; is_misc: boolean }>
  >([]);

  // Nova entrega (carrinho local)
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerOptions, setCustomerOptions] = useState<Customer[]>([]);
  const [novaAddr, setNovaAddr] = useState<DeliveryAddressFormValue>(emptyDeliveryAddress());
  const [draftScan, setDraftScan] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [scanBusy, setScanBusy] = useState(false);
  const [productNotFound, setProductNotFound] = useState(false);
  const [creating, setCreating] = useState(false);
  const [discountInput, setDiscountInput] = useState('0,00');

  // Pagamento / detalhe
  const [showPay, setShowPay] = useState(false);
  const [payMethod, setPayMethod] = useState('dinheiro');
  const [payCardType, setPayCardType] = useState<CardType | null>(null);
  const [showCardModal, setShowCardModal] = useState(false);
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

  const cartSubtotal = cart.reduce((s, l) => s + l.unit_price_cents * l.quantity, 0);
  const cartUnits = cart.reduce((s, l) => s + l.quantity, 0);
  const discountCents = (() => {
    const n = Number(String(discountInput).replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(Math.round(n * 100), cartSubtotal);
  })();
  const cartTotal = Math.max(0, cartSubtotal - discountCents);

  async function load() {
    try {
      const params: { status?: string; payment_status?: string } = {};
      if (
        listFilter === 'pago' ||
        listFilter === 'parcial' ||
        listFilter === 'pix_pendente' ||
        listFilter === 'pagamento_na_entrega' ||
        listFilter === 'nao_pago'
      ) {
        params.payment_status = listFilter;
      } else if (listFilter) {
        params.status = listFilter;
      }
      const list = await fetchDeliveryOrdersApi(params);
      setOrders(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar pedidos');
    }
  }

  async function openOrderPdf(orderId: number) {
    try {
      const meta = await generateDeliveryOrderPdfApi(orderId);
      window.open(meta.view_url, '_blank', 'noopener,noreferrer');
      setNotice(
        meta.pending
          ? `PDF do pedido gerado (pagamento pendente): ${meta.filename}`
          : `Comprovante PDF gerado: ${meta.filename}`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao gerar PDF do pedido');
    }
  }

  async function sendOrderPdfWhatsApp(order: DeliveryOrder) {
    try {
      const share = await deliveryOrderWhatsappShareApi(order.id, {
        phone: order.whatsapp || order.phone || undefined,
      });
      if (share.pdf?.view_url) {
        window.open(share.pdf.view_url, '_blank', 'noopener,noreferrer');
      }
      window.setTimeout(() => {
        window.open(share.url, '_blank', 'noopener,noreferrer');
      }, 350);
      setNotice(
        share.note ||
          `PDF gerado (${share.pdf?.filename || 'arquivo'}). Anexe o PDF na conversa do WhatsApp.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao enviar PDF no WhatsApp');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listFilter]);

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
    setNovaAddr(emptyDeliveryAddress());
    setDraftScan('');
    setCart([]);
    setDiscountInput('0,00');
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
    if (!isDeliveryAddressComplete(novaAddr)) {
      setError('ENDEREÇO INCOMPLETO PARA GERAR ROTA. Informe rua, número e cidade.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await createDeliveryOrderApi({
        client_request_id: `ui-ord-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        customer_id: customer?.id ?? null,
        customer_name: customer?.name || customerQuery.trim() || null,
        phone: novaAddr.phone.trim() || customer?.phone || null,
        address: novaAddr.address.trim(),
        address_number: novaAddr.address_number.trim(),
        complement: novaAddr.complement.trim() || null,
        neighborhood: novaAddr.neighborhood.trim() || null,
        city: novaAddr.city.trim(),
        state: novaAddr.state.trim() || null,
        zip_code: novaAddr.zip_code.trim() || null,
        reference_note: novaAddr.reference_note.trim() || null,
        notes: novaAddr.notes.trim() || null,
        discount_cents: discountCents,
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
        const changeCents = received
          ? Math.round(Number(String(received).replace(',', '.')) * 100)
          : null;
        const updated = await confirmDeliveryOrderPaymentApi(selected.id, {
          mark_pagamento_na_entrega: true,
          expected_payment_method: payMethod === 'misto' ? 'dinheiro' : payMethod,
          change_for_cents: payMethod === 'dinheiro' ? changeCents : null,
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
        if (mistoSecond === 'cartao' && !payCardType) {
          setShowCardModal(true);
          return;
        }
        payments = [
          { method: 'dinheiro', amount_cents: a1, amount_received_cents: a1 },
          {
            method: mistoSecond,
            amount_cents: a2,
            ...(mistoSecond === 'cartao' ? { card_type: payCardType } : {}),
          },
        ];
      } else {
        if (payMethod === 'cartao' && !payCardType) {
          setShowCardModal(true);
          return;
        }
        payments = [
          {
            method: payMethod,
            amount_cents: cents,
            ...(payMethod === 'dinheiro' && received
              ? { amount_received_cents: Math.round(Number(String(received).replace(',', '.')) * 100) }
              : {}),
            ...(payMethod === 'cartao' ? { card_type: payCardType } : {}),
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

  function openEdit() {
    if (!selected) return;
    setEditAddr({
      phone: selected.phone || '',
      zip_code: selected.zip_code || '',
      address: selected.address || '',
      address_number: selected.address_number || '',
      complement: selected.complement || '',
      neighborhood: selected.neighborhood || '',
      city: selected.city || '',
      state: selected.state || '',
      reference_note: selected.reference_note || '',
      notes: selected.notes || '',
    });
    setEditItems(
      (selected.items || []).map((it) => ({
        product_id: it.product_id ?? null,
        name: it.product_name,
        quantity: it.quantity,
        unit_price_cents: it.unit_price_cents,
        is_misc: Boolean(it.is_misc),
      }))
    );
    setShowEdit(true);
  }

  async function saveEdit() {
    if (!selected) return;
    if (!editItems.length || editItems.some((it) => it.quantity < 1)) {
      setError('Pedido precisa de itens com quantidade válida');
      return;
    }
    if (!isDeliveryAddressComplete(editAddr)) {
      setError('ENDEREÇO INCOMPLETO PARA GERAR ROTA. Informe rua, número e cidade.');
      return;
    }
    try {
      const updated = await updateDeliveryOrderApi(selected.id, {
        phone: editAddr.phone.trim() || null,
        address: editAddr.address.trim(),
        address_number: editAddr.address_number.trim(),
        complement: editAddr.complement.trim() || null,
        neighborhood: editAddr.neighborhood.trim() || null,
        city: editAddr.city.trim(),
        state: editAddr.state.trim() || null,
        zip_code: editAddr.zip_code.trim() || null,
        reference_note: editAddr.reference_note.trim() || null,
        notes: editAddr.notes.trim() || null,
        discount_cents: selected.discount_cents || 0,
        items: editItems.map((it) => ({
          product_id: it.product_id,
          name: it.name,
          quantity: it.quantity,
          unit_price_cents: it.unit_price_cents,
          is_misc: it.is_misc,
        })),
      });
      setSelected(updated);
      setShowEdit(false);
      setNotice('Pedido atualizado. Reserva reajustada. Continua aguardando pagamento.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao editar pedido');
    }
  }

  const unpaid =
    selected &&
    selected.status !== 'cancelado' &&
    selected.payment_status !== 'pago';
  const paidConfirmed = selected?.payment_status === 'pago';

  return (
    <>
      <div className="entregas-hero-cta" data-testid="entregas-hero">
        <div>
          <strong>PEDIDOS DE ENTREGA</strong>
          <p className="muted-line" style={{ margin: '4px 0 0' }}>
            Monte o pedido com leitor → salve como AGUARDANDO PAGAMENTO → só depois confirme recebimento.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-entregas-novo"
          data-testid="btn-novo-pedido-entrega"
          onClick={openNova}
        >
          NOVO PEDIDO DE ENTREGA
        </button>
      </div>

      <ModuleToolbar>
        <select className="field-input" value={listFilter} onChange={(e) => setListFilter(e.target.value)}>
          <option value="">Todos</option>
          <option value="aguardando_pagamento">AGUARDANDO PAGAMENTO</option>
          <option value="nao_pago">Não pago</option>
          <option value="pago">PAGO</option>
          <option value="em_separacao">EM SEPARAÇÃO</option>
          <option value="pronto_para_entrega">PRONTO</option>
          <option value="saiu_para_entrega">EM ROTA</option>
          <option value="entregue">ENTREGUE</option>
          <option value="cancelado">CANCELADO</option>
          <option value="pix_pendente">PIX pendente</option>
          <option value="pagamento_na_entrega">Pagamento na entrega</option>
          <option value="parcial">Parcial</option>
        </select>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setView('lista');
            void load();
          }}
        >
          Lista de pedidos
        </button>
        <button
          type="button"
          className="btn btn-accent"
          data-testid="btn-novo-pedido-entrega-toolbar"
          onClick={openNova}
        >
          NOVO PEDIDO DE ENTREGA
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
        <div className="side-card entregas-nova-pedido" style={{ marginBottom: 16 }} data-testid="tela-novo-pedido-entrega">
          <h2 style={{ marginTop: 0 }}>NOVO PEDIDO DE ENTREGA</h2>
          <div className="alert alert-ok" style={{ marginBottom: 12 }}>
            Isto <strong>não é venda paga</strong>. Ao criar: status AGUARDANDO PAGAMENTO · reserva estoque ·{' '}
            <strong>não entra no caixa</strong>.
          </div>

          <h3>Cliente</h3>
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
                placeholder="SELECIONAR CLIENTE (nome)"
                list="entrega-clientes"
                data-testid="entrega-cliente"
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
                        setNovaAddr({
                          phone: c.phone || c.whatsapp || '',
                          zip_code: c.zip_code || '',
                          address: c.address || '',
                          address_number: c.address_number || '',
                          complement: '',
                          neighborhood: c.neighborhood || '',
                          city: c.city || '',
                          state: c.state || '',
                          reference_note: '',
                          notes: '',
                        });
                      }}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </label>
          </div>

          <h3>ENDEREÇO DE ENTREGA</h3>
          <DeliveryAddressForm value={novaAddr} onChange={setNovaAddr} showCustomerHint />

          <h3 style={{ marginTop: 16 }}>LER CÓDIGO / BUSCAR PRODUTO</h3>
          <input
            ref={draftScanRef}
            className="field-input entrega-scan-input"
            data-testid="entrega-scan-input"
            value={draftScan}
            disabled={scanBusy || creating}
            placeholder="Passe o código de barras ou digite o produto..."
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

          {productNotFound && (
            <div className="alert alert-error" style={{ marginTop: 12, marginBottom: 12 }}>
              <strong>PRODUTO NÃO ENCONTRADO</strong>
              <div>Não foi criado produto automaticamente. Passe outro código.</div>
            </div>
          )}

          <h3 data-testid="carrinho-entrega-titulo">CARRINHO DA ENTREGA</h3>
          <table className="data-table" data-testid="carrinho-entrega">
            <thead>
              <tr>
                <th>PRODUTO</th>
                <th>VALOR UNITÁRIO</th>
                <th>QUANTIDADE</th>
                <th>SUBTOTAL</th>
                <th>REMOVER</th>
              </tr>
            </thead>
            <tbody>
              {cart.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted-line">
                    Carrinho vazio. Use o leitor ou digite o produto acima.
                  </td>
                </tr>
              )}
              {cart.map((line) => (
                <tr key={line.key}>
                  <td>
                    {line.name}
                    {line.barcode ? <div className="muted-line">{line.barcode}</div> : null}
                  </td>
                  <td>{formatBRL(line.unit_price_cents)}</td>
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

          <div className="entrega-cart-footer" data-testid="entrega-cart-footer">
            <div>
              Itens: <strong>{cart.length}</strong>
            </div>
            <div>
              Total de unidades: <strong>{cartUnits}</strong>
            </div>
            <div>
              Subtotal: <strong>{formatBRL(cartSubtotal)}</strong>
            </div>
            <label>
              Desconto (R$)
              <input
                className="field-input"
                value={discountInput}
                onChange={(e) => setDiscountInput(e.target.value)}
                inputMode="decimal"
              />
            </label>
            <div className="entrega-cart-total">
              TOTAL DO PEDIDO: <strong>{formatBRL(cartTotal)}</strong>
            </div>
          </div>

          <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                resetNova();
                setView('lista');
              }}
            >
              Voltar à lista
            </button>
            <button
              type="button"
              className="btn btn-primary btn-entregas-novo"
              data-testid="btn-criar-pedido-entrega"
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
            <table className="data-table" data-testid="lista-pedidos-entrega">
              <thead>
                <tr>
                  <th>PEDIDO</th>
                  <th>CLIENTE</th>
                  <th>ENDEREÇO</th>
                  <th>TOTAL</th>
                  <th>STATUS</th>
                  <th>DATA/HORA</th>
                  <th>AÇÕES</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted-line">
                      Nenhum pedido ainda. Clique em <strong>NOVO PEDIDO DE ENTREGA</strong>.
                    </td>
                  </tr>
                )}
                {orders.map((o) => (
                  <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => void openOrder(o.id)}>
                    <td>{o.order_number}</td>
                    <td>{o.customer_name || '—'}</td>
                    <td>
                      {[o.address, o.address_number, o.neighborhood, o.city].filter(Boolean).join(', ') ||
                        '—'}
                    </td>
                    <td>{formatBRL(o.total_cents)}</td>
                    <td>
                      <StatusPill tone={tone(o.status, o.payment_status)}>{statusLabel(o)}</StatusPill>
                    </td>
                    <td>{formatDateTime(o.created_at)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-primary"
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
            <div className="side-card" data-testid="detalhe-pedido-entrega">
              <h3>
                Nº {selected.order_number}{' '}
                <StatusPill tone={tone(selected.status, selected.payment_status)}>
                  {statusLabel(selected)}
                </StatusPill>
              </h3>

              <div className="entrega-acoes-principais" data-testid="entrega-acoes-principais">
                {unpaid && (
                  <>
                    <button type="button" className="btn btn-ghost" onClick={openEdit}>
                      EDITAR PEDIDO
                    </button>
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
                      CONFIRMAR PAGAMENTO / RECEBIMENTO
                    </button>
                    {selected.payment_status !== 'pagamento_na_entrega' &&
                      selected.payment_status !== 'pix_pendente' && (
                        <button
                          type="button"
                          className="btn btn-accent"
                          onClick={() => {
                            setPayAmount(
                              ((selected.total_cents - selected.amount_paid_cents) / 100).toFixed(2)
                            );
                            setPayMethod('dinheiro');
                            setShowPay(true);
                            setNotice(
                              'Escolha a forma prevista e use “Pagar na entrega (sem caixa)”.'
                            );
                          }}
                        >
                          PAGAMENTO NA ENTREGA
                        </button>
                      )}
                  </>
                )}
                {selected.status !== 'cancelado' && unpaid && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => {
                      const el = document.getElementById('entrega-cancel-block');
                      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }}
                  >
                    CANCELAR PEDIDO
                  </button>
                )}
              </div>

              <p>
                <strong>STATUS FINANCEIRO:</strong> {statusLabel(selected)}
              </p>
              <p>
                <strong>STATUS DA ENTREGA:</strong>{' '}
                {String(selected.status || '').replaceAll('_', ' ').toUpperCase()}
              </p>
              <p>
                <strong>Cliente:</strong> {selected.customer_name || '—'}
              </p>
              <p>
                <strong>Telefone:</strong> {selected.phone || '—'}
              </p>
              <p>
                <strong>Total:</strong> {formatBRL(selected.total_cents)}
                {selected.discount_cents ? ` (desc. ${formatBRL(selected.discount_cents)})` : ''} ·{' '}
                <strong>Pago:</strong> {formatBRL(selected.amount_paid_cents)}
              </p>

              <DeliveryRoutePanel
                order={selected}
                onOrderUpdated={setSelected}
                onNotice={setNotice}
                onError={setError}
              />

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
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void openOrderPdf(selected.id)}
                >
                  {paidConfirmed ? 'Visualizar comprovante PDF' : 'PDF pedido (pagamento pendente)'}
                </button>
                <button
                  type="button"
                  className="btn btn-accent"
                  onClick={() => void sendOrderPdfWhatsApp(selected)}
                >
                  Enviar PDF no WhatsApp
                </button>
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
                  <>
                    <div className="alert alert-error" style={{ width: '100%' }}>
                      PAGAMENTO PENDENTE NA ENTREGA — sem entrada no caixa até confirmar.
                    </div>
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
                      RECEBIMENTO CONFIRMADO
                    </button>
                  </>
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
                <div id="entrega-cancel-block" style={{ marginTop: 12 }}>
                  <label>
                    CANCELAR PEDIDO (libera reserva, sem caixa)
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
                    CANCELAR PEDIDO
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
                  onChange={(e) => {
                    const next = e.target.value;
                    setPayMethod(next);
                    if (next === 'cartao') {
                      setShowCardModal(true);
                    } else if (!(next === 'misto' && mistoSecond === 'cartao')) {
                      setPayCardType(null);
                    }
                  }}
                >
                  <option value="dinheiro">DINHEIRO</option>
                  <option value="pix">PIX</option>
                  <option value="cartao">CARTÃO</option>
                  <option value="crediario">CREDIÁRIO</option>
                  <option value="misto">MISTO</option>
                </select>
              </label>
              {payMethod === 'cartao' && payCardType ? (
                <div className="muted-line" data-testid="entrega-card-type">
                  Cartão:{' '}
                  <strong>{payCardType === 'CREDIT' ? 'CRÉDITO' : 'DÉBITO'}</strong>
                  <button
                    type="button"
                    className="linkish"
                    style={{ marginLeft: 8 }}
                    onClick={() => setShowCardModal(true)}
                  >
                    Alterar
                  </button>
                </div>
              ) : null}
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
                      onChange={(e) => {
                        const next = e.target.value;
                        setMistoSecond(next);
                        if (next === 'cartao') setShowCardModal(true);
                        else setPayCardType(null);
                      }}
                    >
                      <option value="pix">PIX</option>
                      <option value="cartao">CARTÃO</option>
                      <option value="crediario">CREDIÁRIO</option>
                    </select>
                  </label>
                  {mistoSecond === 'cartao' && payCardType ? (
                    <div className="muted-line">
                      Cartão:{' '}
                      <strong>{payCardType === 'CREDIT' ? 'CRÉDITO' : 'DÉBITO'}</strong>
                    </div>
                  ) : null}
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
              {selected.payment_status !== 'pagamento_na_entrega' &&
                selected.payment_status !== 'pix_pendente' &&
                selected.payment_status !== 'pago' && (
                  <button
                    type="button"
                    className="btn btn-accent"
                    onClick={() => void confirmPay({ markCod: true })}
                  >
                    Pagar na entrega (sem caixa)
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

      {showCardModal && selected && (
        <CardPaymentModal
          totalCents={
            Math.round(Number(String(payAmount).replace(',', '.')) * 100) ||
            selected.total_cents - selected.amount_paid_cents
          }
          initialType={payCardType}
          onBack={() => {
            setShowCardModal(false);
            if (payMethod === 'cartao' && !payCardType) setPayMethod('dinheiro');
            if (payMethod === 'misto' && mistoSecond === 'cartao' && !payCardType) {
              setMistoSecond('pix');
            }
          }}
          onConfirm={(selectedType) => {
            setPayCardType(selectedType);
            setShowCardModal(false);
          }}
        />
      )}

      {showEdit && selected && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h2>EDITAR PEDIDO {selected.order_number}</h2>
            <p className="muted-line">Somente pedidos não pagos. Reserva será reajustada.</p>
            <DeliveryAddressForm value={editAddr} onChange={setEditAddr} showCustomerHint />
            <table className="data-table" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Qtd</th>
                  <th>Unit.</th>
                </tr>
              </thead>
              <tbody>
                {editItems.map((it, idx) => (
                  <tr key={`${it.product_id ?? 'm'}-${idx}`}>
                    <td>{it.name}</td>
                    <td>
                      <input
                        className="field-input"
                        style={{ width: 72 }}
                        type="number"
                        min={1}
                        value={it.quantity}
                        onChange={(e) => {
                          const q = Math.max(1, Number(e.target.value) || 1);
                          setEditItems((prev) =>
                            prev.map((row, i) => (i === idx ? { ...row, quantity: q } : row))
                          );
                        }}
                      />
                    </td>
                    <td>{formatBRL(it.unit_price_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowEdit(false)}>
                Voltar
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void saveEdit()}>
                Salvar alterações
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
