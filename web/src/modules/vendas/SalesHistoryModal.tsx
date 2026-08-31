import { useEffect, useMemo, useState } from 'react';
import {
  amendSaleApi,
  cancelSale,
  fetchProducts,
  fetchSale,
  fetchSaleRelated,
  fetchSalesPaged,
  formatBRL,
  paymentLabel,
  type Customer,
  type Product,
  type Sale,
  type SaleRelated,
} from '../../api/client';
import ReceiptModal from './ReceiptModal';
import ChoosePrinterModal from '../../components/ChoosePrinterModal';
import { printSaleReceipt, saveSaleReceiptPdf } from '../../lib/saleDocuments';
import AdminAuthModal, { CANCEL_REASON_OPTIONS } from './AdminAuthModal';
import CustomerPicker from './CustomerPicker';

type Period = '' | 'today' | 'yesterday' | 'last7' | 'month' | 'custom';

const PAGE_SIZE = 100;

type EditLine = {
  key: string;
  product_id: number | null;
  name: string;
  barcode?: string | null;
  quantity: number;
  unit_price_cents: number;
  is_misc: boolean;
};

function formatDateTimeParts(value?: string | null): { date: string; time: string } {
  if (!value) return { date: '—', time: '—' };
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (m) return { date: `${m[3]}/${m[2]}/${m[1]}`, time: `${m[4]}:${m[5]}` };
  return { date: value, time: '—' };
}

function situationOf(s: Sale): string {
  if (s.status === 'cancelled') return 'CANCELADA';
  if (s.amended_at || s.situation_label === 'Alterada') return 'ALTERADA';
  return s.situation_label || 'Concluída';
}

type Props = {
  onClose?: () => void;
  embedded?: boolean;
};

export default function SalesHistoryModal({ onClose, embedded }: Props) {
  const [sales, setSales] = useState<Sale[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState('');
  const [period, setPeriod] = useState<Period>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [payment, setPayment] = useState('');
  const [status, setStatus] = useState('');
  const [operator, setOperator] = useState('');
  const [saleNumber, setSaleNumber] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<Sale | null>(null);
  const [related, setRelated] = useState<SaleRelated | null>(null);
  const [reprintSale, setReprintSale] = useState<Sale | null>(null);
  const [quickBusyId, setQuickBusyId] = useState<number | null>(null);
  const [receipt, setReceipt] = useState<Sale | null>(null);

  const [authMode, setAuthMode] = useState<null | 'amend' | 'cancel'>(null);
  const [authSale, setAuthSale] = useState<Sale | null>(null);
  const [editSale, setEditSale] = useState<Sale | null>(null);
  const [editItems, setEditItems] = useState<EditLine[]>([]);
  const [editDiscount, setEditDiscount] = useState('0,00');
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [editScan, setEditScan] = useState('');
  const [editAuthPassword, setEditAuthPassword] = useState('');
  const [editReason, setEditReason] = useState('');
  const [showSummary, setShowSummary] = useState(false);

  async function load(nextOffset = 0) {
    setBusy(true);
    setError(null);
    try {
      const page = await fetchSalesPaged({
        limit: PAGE_SIZE,
        offset: nextOffset,
        q: q.trim() || undefined,
        period: period && period !== 'custom' ? period : undefined,
        from: period === 'custom' && from ? from : undefined,
        to: period === 'custom' && to ? to : undefined,
        payment_method: payment || undefined,
        status: status || undefined,
        operator: operator.trim() || undefined,
        sale_number: saleNumber.trim() || undefined,
        customer: customerFilter.trim() || undefined,
      });
      setSales(page.items);
      setTotal(page.total);
      setOffset(page.offset);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar histórico');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const t = window.setTimeout(() => void load(0), 200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, period, from, to, payment, status, operator, saleNumber, customerFilter]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageIndex = Math.floor(offset / PAGE_SIZE) + 1;

  const editSubtotal = useMemo(
    () => editItems.reduce((s, it) => s + it.unit_price_cents * it.quantity, 0),
    [editItems]
  );
  const editDiscountCents = useMemo(() => {
    const n = Number(String(editDiscount).replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n * 100);
  }, [editDiscount]);
  const editTotal = Math.max(0, editSubtotal - editDiscountCents);

  async function openDetail(id: number) {
    try {
      setRelated(null);
      setDetail(await fetchSale(id));
      // Crediário / entrega / devoluções são carregados em seguida, sem travar o detalhe.
      fetchSaleRelated(id)
        .then(setRelated)
        .catch(() => setRelated(null));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao abrir venda');
    }
  }

  /** PDF direto da linha. Somente leitura: não altera venda, estoque nem caixa. */
  async function quickPdf(sale: Sale) {
    setQuickBusyId(sale.id);
    setError(null);
    setNotice(null);
    try {
      const res = await saveSaleReceiptPdf(sale);
      if (res.canceled) return;
      if (!res.ok) {
        setError(res.error || 'Não foi possível gerar o PDF.');
        return;
      }
      setNotice(
        res.filePath
          ? `PDF da venda ${sale.sale_number} salvo em ${res.filePath}. A venda não foi alterada.`
          : `PDF da venda ${sale.sale_number} gerado. A venda não foi alterada.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao gerar PDF');
    } finally {
      setQuickBusyId(null);
    }
  }

  function startAmend(sale: Sale) {
    if (sale.status === 'cancelled') {
      setError('Venda cancelada não pode ser alterada.');
      return;
    }
    setAuthSale(sale);
    setAuthMode('amend');
  }

  function startCancel(sale: Sale) {
    if (sale.status === 'cancelled') {
      setError('Venda já está cancelada.');
      return;
    }
    setAuthSale(sale);
    setAuthMode('cancel');
  }

  async function onAuthorized({ password, reason }: { password: string; reason: string }) {
    if (!authSale || !authMode) return;
    if (authMode === 'cancel') {
      const cancelled = await cancelSale(authSale.id, {
        reason,
        admin_password: password,
        authorized_by: 'Administrador',
      });
      setAuthMode(null);
      setAuthSale(null);
      setNotice(`Venda ${cancelled.sale_number} cancelada. Histórico preservado.`);
      setReceipt(cancelled);
      await load(offset);
      return;
    }
    // amend: abre editor com senha/motivo guardados
    const full = await fetchSale(authSale.id);
    setEditAuthPassword(password);
    setEditReason(reason);
    setEditSale(full);
    setEditCustomer((full.customer as Customer | null) || null);
    setEditDiscount(((full.discount_cents || 0) / 100).toFixed(2).replace('.', ','));
    setEditItems(
      (full.items || []).map((it, idx) => ({
        key: it.product_id ? `p-${it.product_id}` : `m-${it.id ?? idx}`,
        product_id: it.product_id,
        name: it.name,
        barcode: it.barcode,
        quantity: it.quantity,
        unit_price_cents: it.unit_price_cents,
        is_misc: Boolean(it.is_misc),
      }))
    );
    setAuthMode(null);
    setAuthSale(null);
    setShowSummary(false);
  }

  function addProductToEdit(product: Product) {
    setEditItems((prev) => {
      const idx = prev.findIndex((l) => l.product_id === product.id && !l.is_misc);
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
          quantity: 1,
          unit_price_cents: Number(product.price_cents) || 0,
          is_misc: false,
        },
      ];
    });
  }

  async function handleEditScan() {
    const code = editScan.trim();
    if (!code) return;
    if (/^[0-9]{8,18}$/.test(code)) {
      const found = await fetchProducts({ barcode: code });
      const exact = found.find((p) => p.barcode === code && p.active !== 0);
      if (exact) {
        addProductToEdit(exact);
        setEditScan('');
        return;
      }
      setError('Produto não encontrado para este código.');
      return;
    }
    const found = (await fetchProducts({ q: code })).filter((p) => p.active !== 0);
    if (found.length === 1) {
      addProductToEdit(found[0]);
      setEditScan('');
    } else if (found.length === 0) {
      setError('Nenhum produto encontrado.');
    } else {
      setError('Vários produtos encontrados. Refine a busca ou use o código de barras.');
    }
  }

  async function saveAmend() {
    if (!editSale) return;
    if (!editItems.length) {
      setError('A venda precisa de itens.');
      return;
    }
    if (!showSummary) {
      setShowSummary(true);
      return;
    }
    try {
      const updated = await amendSaleApi(editSale.id, {
        admin_password: editAuthPassword,
        reason: editReason,
        authorized_by: 'Administrador',
        customer_id: editCustomer?.id ?? null,
        discount_cents: editDiscountCents,
        items: editItems.map((it) => ({
          product_id: it.product_id,
          name: it.name,
          quantity: it.quantity,
          unit_price_cents: it.unit_price_cents,
          is_misc: it.is_misc,
        })),
      });
      setEditSale(null);
      setEditAuthPassword('');
      setEditReason('');
      setShowSummary(false);
      setNotice(`Venda ${updated.sale_number} alterada. Estoque/caixa ajustados pela diferença.`);
      setReceipt(updated);
      await load(offset);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao alterar venda');
    }
  }

  const body = (
    <>
      <h3>HISTÓRICO DE VENDAS</h3>
      <p className="muted-line">
        Todas as vendas acessíveis. PDF / impressão / WhatsApp não alteram estoque nem caixa.
      </p>
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <label className="span-2">
          Busca
          <input className="field-input" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label>
          Período
          <select className="field-input" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
            <option value="">Todas</option>
            <option value="today">Hoje</option>
            <option value="yesterday">Ontem</option>
            <option value="last7">Últimos 7 dias</option>
            <option value="month">Este mês</option>
            <option value="custom">Período personalizado</option>
          </select>
        </label>
        <label>
          Pagamento
          <select className="field-input" value={payment} onChange={(e) => setPayment(e.target.value)}>
            <option value="">Todas</option>
            <option value="dinheiro">Dinheiro</option>
            <option value="pix">Pix</option>
            <option value="cartao_credito">Cartão Crédito</option>
            <option value="cartao_debito">Cartão Débito</option>
            <option value="crediario">Crediário</option>
            <option value="misto">Misto</option>
          </select>
        </label>
        <label>
          Situação
          <select className="field-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todas</option>
            <option value="completed">Concluída</option>
            <option value="alterada">Alterada</option>
            <option value="cancelled">Cancelada</option>
          </select>
        </label>
        <label>
          Nº da venda
          <input className="field-input" value={saleNumber} onChange={(e) => setSaleNumber(e.target.value)} />
        </label>
        <label>
          Cliente
          <input className="field-input" value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)} />
        </label>
        <label>
          Operador
          <input className="field-input" value={operator} onChange={(e) => setOperator(e.target.value)} />
        </label>
        {period === 'custom' && (
          <>
            <label>
              De
              <input className="field-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label>
              Até
              <input className="field-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </>
        )}
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}
      <p className="muted-line">
        {busy ? 'Carregando…' : `${total} venda(s) · página ${pageIndex}/${pageCount}`}
      </p>
      <div className="product-table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
        <table className="product-table" data-testid="historico-vendas-tabela">
          <thead>
            <tr>
              <th>Nº</th>
              <th>Data</th>
              <th>Hora</th>
              <th>Cliente</th>
              <th>Operador</th>
              <th>Itens</th>
              <th>Pagamento</th>
              <th>Total</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((s) => {
              const { date, time } = formatDateTimeParts(s.created_at);
              return (
                <tr key={s.id}>
                  <td>{s.sale_number}</td>
                  <td>{date}</td>
                  <td>{time || '—'}</td>
                  <td>{s.customer_name || '—'}</td>
                  <td>{s.operator_name || '—'}</td>
                  <td>{s.items_count ?? '—'}</td>
                  <td>{paymentLabel(s.payment_method)}</td>
                  <td>{formatBRL(s.total_cents)}</td>
                  <td>
                    <strong>{situationOf(s)}</strong>
                  </td>
                  <td className="row-actions">
                    <button type="button" className="btn btn-primary" onClick={() => void openDetail(s.id)}>
                      VER
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={quickBusyId === s.id}
                      onClick={() => setReprintSale(s)}
                    >
                      REIMPRIMIR
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={quickBusyId === s.id}
                      onClick={() => void quickPdf(s)}
                    >
                      {quickBusyId === s.id ? '…' : 'PDF'}
                    </button>
                  </td>
                </tr>
              );
            })}
            {!busy && sales.length === 0 && (
              <tr>
                <td colSpan={10}>Nenhuma venda encontrada.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={offset <= 0 || busy}
            onClick={() => void load(Math.max(0, offset - PAGE_SIZE))}
          >
            Anterior
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={offset + PAGE_SIZE >= total || busy}
            onClick={() => void load(offset + PAGE_SIZE)}
          >
            Próxima
          </button>
        </div>
        {onClose && (
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Fechar
          </button>
        )}
      </div>
    </>
  );

  return (
    <>
      {embedded ? (
        <section className="module-panel">{body}</section>
      ) : (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Histórico de vendas">
          <div className="modal modal-wide" style={{ width: 'min(1100px, 100%)' }}>
            {body}
          </div>
        </div>
      )}

      {detail && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal modal-wide" style={{ width: 'min(900px, 100%)' }}>
            <h3>Abrir venda — {detail.sale_number}</h3>
            <div className="form-grid" style={{ marginBottom: 12 }}>
              <div>
                <strong>Número</strong>
                <div>{detail.sale_number}</div>
              </div>
              <div>
                <strong>Data / Hora</strong>
                <div>{detail.created_at}</div>
              </div>
              <div>
                <strong>Cliente</strong>
                <div>{detail.customer?.name || detail.customer_name || '—'}</div>
              </div>
              <div>
                <strong>Telefone</strong>
                <div>
                  {detail.customer?.whatsapp || detail.customer?.phone || '—'}
                </div>
              </div>
              <div>
                <strong>Status</strong>
                <div>{situationOf(detail)}</div>
              </div>
              <div>
                <strong>Operador</strong>
                <div>
                  {detail.operator_name ||
                    detail.amend_authorized_by ||
                    detail.amended_by ||
                    detail.cancelled_by ||
                    '—'}
                </div>
              </div>
            </div>

            <h4>Produtos</h4>
            <table className="product-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Produto</th>
                  <th>Qtd</th>
                  <th>Unit.</th>
                  <th>Desconto</th>
                  <th>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {(detail.items || []).map((it) => (
                  <tr key={it.id}>
                    <td>{it.barcode || '—'}</td>
                    <td>
                      {it.name}
                      {it.is_misc ? ' (Diversos)' : ''}
                    </td>
                    <td>{it.quantity}</td>
                    <td>{formatBRL(it.unit_price_cents)}</td>
                    <td>{formatBRL(it.discount_cents || 0)}</td>
                    <td>{formatBRL(it.line_total_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h4 style={{ marginTop: 12 }}>Pagamento</h4>
            <div className="form-grid" style={{ marginBottom: 8 }}>
              <div className="span-2">
                <strong>Formas</strong>
                <div>
                  {(detail.payments || [])
                    .map((p) => `${paymentLabel(p.method, p.card_type)} (${formatBRL(p.amount_cents)})`)
                    .join(' + ') || paymentLabel(detail.payment_method) || '—'}
                </div>
              </div>
              <div>
                <strong>Subtotal</strong>
                <div>{formatBRL(detail.subtotal_cents)}</div>
              </div>
              <div>
                <strong>Descontos</strong>
                <div>{formatBRL(detail.discount_cents)}</div>
              </div>
              <div>
                <strong>Total final</strong>
                <div>{formatBRL(detail.total_cents)}</div>
              </div>
              <div>
                <strong>Valor recebido</strong>
                <div>{formatBRL(detail.amount_received_cents || 0)}</div>
              </div>
              <div>
                <strong>Troco</strong>
                <div>{formatBRL(detail.change_cents || 0)}</div>
              </div>
            </div>

            {related?.credit ? (
              <>
                <h4 style={{ marginTop: 12 }}>Crediário</h4>
                <p className="muted-line">
                  Situação <strong>{related.credit.status}</strong> · total{' '}
                  {formatBRL(related.credit.total_cents)} · entrada{' '}
                  {formatBRL(related.credit.entry_cents)} · pago{' '}
                  {formatBRL(related.credit.paid_cents)} · saldo{' '}
                  <strong>{formatBRL(related.credit.balance_cents)}</strong> em{' '}
                  {related.credit.installment_count}x
                </p>
                <table className="product-table">
                  <thead>
                    <tr>
                      <th>Parcela</th>
                      <th>Vencimento</th>
                      <th>Valor</th>
                      <th>Pago</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {related.credit.installments.map((i) => (
                      <tr key={i.installment_number}>
                        <td>{i.installment_number}</td>
                        <td>{i.due_date || '—'}</td>
                        <td>{formatBRL(i.amount_cents)}</td>
                        <td>{formatBRL(i.paid_amount_cents)}</td>
                        <td>{i.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}

            {related?.delivery_order || related?.delivery ? (
              <p style={{ marginTop: 12 }}>
                <strong>Entrega:</strong>{' '}
                {related.delivery_order
                  ? `pedido #${related.delivery_order.id} · ${related.delivery_order.status} · pagamento ${related.delivery_order.payment_status}`
                  : `agendada #${related.delivery?.id} · ${related.delivery?.status}`}
                {(related.delivery_order?.scheduled_date || related.delivery?.scheduled_date) &&
                  ` · ${related.delivery_order?.scheduled_date || related.delivery?.scheduled_date}`}
                {(related.delivery_order?.courier_name || related.delivery?.courier_name) &&
                  ` · entregador ${related.delivery_order?.courier_name || related.delivery?.courier_name}`}
              </p>
            ) : null}

            {related?.returns?.length ? (
              <p>
                <strong>Devoluções:</strong>{' '}
                {related.returns
                  .map((r) => `#${r.id} ${formatBRL(r.total_cents)}${r.reason ? ` (${r.reason})` : ''}`)
                  .join(' · ')}
              </p>
            ) : null}

            {detail.notes ? (
              <p>
                <strong>Observações:</strong> {detail.notes}
              </p>
            ) : null}
            {detail.cancelled_at ? (
              <p className="alert alert-error">
                Cancelada em {detail.cancelled_at}
                {detail.cancel_reason ? ` — ${detail.cancel_reason}` : ''}
                {detail.cancelled_by ? ` · ${detail.cancelled_by}` : ''}
              </p>
            ) : null}
            {detail.amended_at ? (
              <p className="alert alert-ok">
                Alterada em {detail.amended_at}
                {detail.amend_reason ? ` — ${detail.amend_reason}` : ''}
                {detail.amended_by ? ` · ${detail.amended_by}` : ''}
              </p>
            ) : null}

            <div className="modal-actions" style={{ flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setDetail(null);
                  setRelated(null);
                }}
              >
                Fechar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setReceipt(detail);
                  setDetail(null);
                }}
              >
                Imprimir / PDF / WhatsApp
              </button>
              {detail.status !== 'cancelled' && (
                <>
                  <button
                    type="button"
                    className="btn btn-accent"
                    onClick={() => {
                      setDetail(null);
                      startAmend(detail);
                    }}
                  >
                    Alterar venda
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => {
                      setDetail(null);
                      startCancel(detail);
                    }}
                  >
                    Excluir / Cancelar
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {reprintSale && (
        <ChoosePrinterModal
          kind="receipt"
          title={`Reimprimir comprovante ${reprintSale.sale_number}`}
          onCancel={() => setReprintSale(null)}
          onConfirm={(choice) => {
            const sale = reprintSale;
            setReprintSale(null);
            setQuickBusyId(sale.id);
            void printSaleReceipt(sale, {
              printerName: choice.printerName || undefined,
              paperFormat: choice.paperFormat,
              reprint: true,
            })
              .then((res) => {
                if (res.ok) setNotice(`Reimpressão enviada: venda ${sale.sale_number}.`);
                else setError(res.error || 'Não foi possível reimprimir.');
              })
              .finally(() => setQuickBusyId(null));
          }}
        />
      )}

      {receipt && (
        <ReceiptModal
          sale={receipt}
          onClose={() => setReceipt(null)}
          onCancelSale={(s) => {
            setReceipt(null);
            startCancel(s);
          }}
        />
      )}

      {authMode && authSale && (
        <AdminAuthModal
          title={
            authMode === 'cancel'
              ? `EXCLUIR / CANCELAR VENDA ${authSale.sale_number}`
              : `ALTERAR VENDA ${authSale.sale_number}`
          }
          subtitle={
            authMode === 'cancel'
              ? 'A venda será cancelada (estorno) e permanecerá no histórico.'
              : 'ESTE PEDIDO JÁ POSSUI PAGAMENTO CONFIRMADO. ALTERAR OS ITENS PODE GERAR DIFERENÇA FINANCEIRA.'
          }
          reasonLabel={authMode === 'cancel' ? 'MOTIVO DA EXCLUSÃO/CANCELAMENTO' : 'MOTIVO DA ALTERAÇÃO'}
          reasonOptions={authMode === 'cancel' ? CANCEL_REASON_OPTIONS : undefined}
          confirmLabel="AUTORIZAR"
          onCancel={() => {
            setAuthMode(null);
            setAuthSale(null);
          }}
          onAuthorized={onAuthorized}
        />
      )}

      {editSale && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal modal-wide" style={{ width: 'min(960px, 100%)' }}>
            <h3>MODO DE EDIÇÃO — {editSale.sale_number}</h3>
            <CustomerPicker selected={editCustomer} onSelect={setEditCustomer} />
            <label>
              Buscar produto ou ler código de barras...
              <input
                className="field-input"
                value={editScan}
                onChange={(e) => setEditScan(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleEditScan();
                  }
                }}
              />
            </label>
            <table className="product-table" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Código</th>
                  <th>Qtd</th>
                  <th>Unit.</th>
                  <th>Subtotal</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {editItems.map((it) => (
                  <tr key={it.key}>
                    <td>{it.name}</td>
                    <td>{it.barcode || (it.product_id != null ? `#${it.product_id}` : '—')}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() =>
                            setEditItems((prev) =>
                              prev.map((row) =>
                                row.key === it.key
                                  ? { ...row, quantity: Math.max(1, row.quantity - 1) }
                                  : row
                              )
                            )
                          }
                        >
                          −
                        </button>
                        <input
                          className="field-input"
                          style={{ width: 64 }}
                          type="number"
                          min={1}
                          value={it.quantity}
                          onChange={(e) => {
                            const qn = Math.max(1, Number(e.target.value) || 1);
                            setEditItems((prev) =>
                              prev.map((row) => (row.key === it.key ? { ...row, quantity: qn } : row))
                            );
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() =>
                            setEditItems((prev) =>
                              prev.map((row) =>
                                row.key === it.key ? { ...row, quantity: row.quantity + 1 } : row
                              )
                            )
                          }
                        >
                          +
                        </button>
                      </div>
                    </td>
                    <td>{formatBRL(it.unit_price_cents)}</td>
                    <td>{formatBRL(it.unit_price_cents * it.quantity)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => setEditItems((prev) => prev.filter((row) => row.key !== it.key))}
                      >
                        REMOVER
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <label>
              Desconto (R$)
              <input className="field-input" value={editDiscount} onChange={(e) => setEditDiscount(e.target.value)} />
            </label>
            <p>
              Subtotal {formatBRL(editSubtotal)} · Total {formatBRL(editTotal)}
            </p>
            {showSummary && (
              <div className="alert alert-ok">
                <strong>RESUMO DA ALTERAÇÃO</strong>
                <div>TOTAL ANTERIOR: {formatBRL(editSale.total_cents)}</div>
                <div>NOVO TOTAL: {formatBRL(editTotal)}</div>
                <div>DIFERENÇA: {formatBRL(editTotal - editSale.total_cents)}</div>
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setEditSale(null);
                  setEditAuthPassword('');
                  setShowSummary(false);
                }}
              >
                CANCELAR ALTERAÇÕES
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void saveAmend()}>
                {showSummary ? 'CONFIRMAR E SALVAR' : 'REVISAR E SALVAR'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
