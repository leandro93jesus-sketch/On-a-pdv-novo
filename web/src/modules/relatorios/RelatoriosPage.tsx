import { useEffect, useMemo, useState } from 'react';
import {
  fetchReportCatalog,
  fetchSale,
  formatBRL,
  paymentLabel,
  runReport,
  type ReportCatalogItem,
  type ReportResult,
  type Sale,
} from '../../api/client';
import { ModuleToolbar } from '../../components/ModuleChrome';
import ChoosePrinterModal from '../../components/ChoosePrinterModal';
import { printDocument } from '../../lib/printDocument';
import ReceiptModal from '../vendas/ReceiptModal';

const VENDAS_PERIODO_LABELS: Record<string, string> = {
  sale_number: 'Número da venda',
  sale_date: 'Data',
  sale_time: 'Hora',
  created_at: 'Data/hora',
  customer_name: 'Cliente',
  items_count: 'Qtd. itens',
  total_cents: 'Total',
  payment_methods: 'Forma de pagamento',
  operator_name: 'Operador',
  status_label: 'Situação',
  sales_count: 'Qtd. vendas',
  completed_count: 'Concluídas',
  cancelled_count: 'Cancelamentos',
  gross_cents: 'Valor bruto',
  cancelled_cents: 'Cancelamentos (R$)',
  returns_count: 'Devoluções',
  returns_cents: 'Devoluções (R$)',
  net_cents: 'Total líquido',
  ticket_avg_cents: 'Ticket médio',
  dinheiro_cents: 'Dinheiro',
  pix_cents: 'Pix',
  cartao_credito_cents: 'Cartão Crédito',
  cartao_debito_cents: 'Cartão Débito',
  cartao_cents: 'Cartão',
  crediario_cents: 'Crediário',
  misto_cents: 'Misto',
  count: 'Qtd. vendas',
  discount_cents: 'Descontos',
};

const SUMMARY_ORDER = [
  'sales_count',
  'gross_cents',
  'cancelled_count',
  'returns_count',
  'returns_cents',
  'net_cents',
  'ticket_avg_cents',
  'dinheiro_cents',
  'pix_cents',
  'cartao_credito_cents',
  'cartao_debito_cents',
  'crediario_cents',
  'misto_cents',
];

function columnLabel(col: string): string {
  if (VENDAS_PERIODO_LABELS[col]) return VENDAS_PERIODO_LABELS[col];
  return col
    .replace(/_cents$/i, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatPaymentMethods(value: unknown): string {
  if (value == null || value === '') return '—';
  const parts = String(value)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > 1) return 'Misto';
  if (parts.length === 1) return paymentLabel(parts[0]);
  return String(value);
}

function formatCell(col: string, value: unknown, reportId?: string): string {
  if (value == null || value === '') return '—';
  if (col === 'payment_methods') return formatPaymentMethods(value);
  if (col === 'items_count') {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return n === 1 ? '1 item' : `${n} itens`;
  }
  if (col === 'sale_date' && typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  if (col === 'sale_time' && typeof value === 'string') {
    return value.slice(0, 5);
  }
  if (typeof value === 'number' && /_cents$/i.test(col)) return formatBRL(value);
  if (typeof value === 'number') return value.toLocaleString('pt-BR');
  if (reportId === 'vendas_periodo' && col === 'status_label' && String(value).toLowerCase().includes('cancel')) {
    return 'CANCELADA';
  }
  return String(value);
}

function formatTotal(key: string, value: unknown): string {
  if (typeof value === 'number' && /_cents$/i.test(key)) return formatBRL(value);
  if (typeof value === 'number') return value.toLocaleString('pt-BR');
  return String(value ?? '—');
}

function rowSaleId(row: Record<string, unknown>): number | null {
  const id = Number(row.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export default function RelatoriosPage() {
  const [catalog, setCatalog] = useState<ReportCatalogItem[]>([]);
  const [reportId, setReportId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterCustomer, setFilterCustomer] = useState('');
  const [filterOperator, setFilterOperator] = useState('');
  const [filterPayment, setFilterPayment] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSaleNumber, setFilterSaleNumber] = useState('');
  const [result, setResult] = useState<ReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [choosePrinter, setChoosePrinter] = useState(false);
  const [detailSale, setDetailSale] = useState<Sale | null>(null);
  const [receiptSale, setReceiptSale] = useState<Sale | null>(null);
  const [actionBusyId, setActionBusyId] = useState<number | null>(null);

  const isVendasPeriodo = reportId === 'vendas_periodo' || result?.id === 'vendas_periodo';

  useEffect(() => {
    void (async () => {
      try {
        const items = await fetchReportCatalog();
        setCatalog(items);
        const prefer = items.find((r) => r.id === 'vendas_periodo') || items[0];
        if (prefer) setReportId(prefer.id);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao carregar catálogo');
      }
    })();
  }, []);

  const summaryEntries = useMemo(() => {
    if (!result?.totals) return [];
    const entries = Object.entries(result.totals);
    if (result.id !== 'vendas_periodo') return entries;
    const ordered: Array<[string, unknown]> = [];
    for (const key of SUMMARY_ORDER) {
      if (key in result.totals) ordered.push([key, result.totals[key]]);
    }
    for (const [key, value] of entries) {
      if (SUMMARY_ORDER.includes(key)) continue;
      if (key === 'count' || key === 'total_cents' || key === 'discount_cents' || key === 'completed_count') {
        continue;
      }
      if (key === 'cartao_cents' && Number(value) === 0) continue;
      if (key === 'cancelled_cents') continue;
      ordered.push([key, value]);
    }
    return ordered;
  }, [result]);

  async function handleRun() {
    if (!reportId) {
      setError('Selecione um relatório');
      return;
    }
    setBusy(true);
    setError(null);
    setDetailSale(null);
    try {
      const filters: Record<string, string | undefined> = {
        from: dateFrom || undefined,
        to: dateTo || undefined,
      };
      if (reportId === 'vendas_periodo') {
        if (filterCustomer.trim()) filters.customer = filterCustomer.trim();
        if (filterOperator.trim()) filters.operator = filterOperator.trim();
        if (filterPayment) filters.payment_method = filterPayment;
        if (filterStatus) filters.status = filterStatus;
        if (filterSaleNumber.trim()) filters.sale_number = filterSaleNumber.trim();
      }
      const data = await runReport(reportId, filters);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao gerar relatório');
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  async function openSaleAction(row: Record<string, unknown>, mode: 'detail' | 'receipt') {
    const id = rowSaleId(row);
    if (!id) {
      setError('Não foi possível identificar a venda nesta linha.');
      return;
    }
    setActionBusyId(id);
    setError(null);
    try {
      const sale = await fetchSale(id);
      if (mode === 'detail') setDetailSale(sale);
      else setReceiptSale(sale);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao abrir venda');
    } finally {
      setActionBusyId(null);
    }
  }

  const displayColumns =
    result?.id === 'vendas_periodo'
      ? (result.columns || []).filter((c) => c !== 'id' && c !== 'status' && c !== 'created_at')
      : result?.columns || [];

  return (
    <section className="module-panel report-print-area">
      <ModuleToolbar>
        <label className="toolbar-field">
          Relatório
          <select
            className="field-input"
            value={reportId}
            onChange={(e) => setReportId(e.target.value)}
          >
            {catalog.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </label>
        <label className="toolbar-field">
          Data inicial
          <input
            className="field-input"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </label>
        <label className="toolbar-field">
          Data final
          <input
            className="field-input"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !reportId}
          onClick={() => void handleRun()}
        >
          {busy ? 'Gerando…' : 'GERAR RELATÓRIO'}
        </button>
        <button
          type="button"
          className="btn btn-ghost no-print"
          disabled={!result}
          onClick={() => setChoosePrinter(true)}
        >
          IMPRIMIR RELATÓRIO
        </button>
      </ModuleToolbar>

      {reportId === 'vendas_periodo' && (
        <div className="form-grid no-print" style={{ marginBottom: 12 }}>
          <label>
            Cliente
            <input
              className="field-input"
              value={filterCustomer}
              onChange={(e) => setFilterCustomer(e.target.value)}
              placeholder="Nome do cliente"
            />
          </label>
          <label>
            Operador
            <input
              className="field-input"
              value={filterOperator}
              onChange={(e) => setFilterOperator(e.target.value)}
              placeholder="Nome do operador"
            />
          </label>
          <label>
            Forma de pagamento
            <select
              className="field-input"
              value={filterPayment}
              onChange={(e) => setFilterPayment(e.target.value)}
            >
              <option value="">Todas</option>
              <option value="dinheiro">Dinheiro</option>
              <option value="pix">Pix</option>
              <option value="cartao_credito">Cartão Crédito</option>
              <option value="cartao_debito">Cartão Débito</option>
              <option value="cartao">Cartão</option>
              <option value="crediario">Crediário</option>
              <option value="misto">Misto</option>
            </select>
          </label>
          <label>
            Situação
            <select
              className="field-input"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="">Todas</option>
              <option value="completed">Concluída</option>
              <option value="cancelled">Cancelada</option>
            </select>
          </label>
          <label>
            Número da venda
            <input
              className="field-input"
              value={filterSaleNumber}
              onChange={(e) => setFilterSaleNumber(e.target.value)}
              placeholder="Ex.: VD-2026…"
            />
          </label>
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}
      {choosePrinter && result && (
        <ChoosePrinterModal
          kind="report"
          title="Escolher impressora"
          onCancel={() => setChoosePrinter(false)}
          onConfirm={(choice) => {
            setChoosePrinter(false);
            void printDocument({
              kind: 'report',
              title: result.title,
              documentType: 'relatorio',
              documentRef: result.id,
              printerName: choice.printerName || undefined,
              paperFormat: choice.paperFormat,
            }).then((res) => {
              if (!res.ok) setError(res.error || 'Não foi possível imprimir o relatório.');
            });
          }}
        />
      )}

      {!result ? (
        <p className="cart-empty">Selecione o período e clique em GERAR RELATÓRIO.</p>
      ) : (
        <div className="report-result">
          <div className="report-heading">
            <h3>{result.title}</h3>
            {result.generated_at ? (
              <p className="muted-line">Gerado em {result.generated_at}</p>
            ) : null}
            {isVendasPeriodo ? (
              <p className="muted-line">
                Lista completa das vendas do período ({(result.rows || []).length} registro
                {(result.rows || []).length === 1 ? '' : 's'}).
              </p>
            ) : null}
          </div>

          {summaryEntries.length > 0 ? (
            <div className="stats-row report-totals">
              {summaryEntries.map(([key, value]) => (
                <div className="stat-card" key={key}>
                  <span>{columnLabel(key)}</span>
                  <strong>{formatTotal(key, value)}</strong>
                </div>
              ))}
            </div>
          ) : null}

          <div className="product-table-wrap" style={{ maxHeight: isVendasPeriodo ? 520 : undefined, overflow: 'auto' }}>
            <table className="product-table report-table" data-testid="relatorio-vendas-tabela">
              <thead>
                <tr>
                  {displayColumns.map((col) => (
                    <th key={col}>{columnLabel(col)}</th>
                  ))}
                  {result.id === 'vendas_periodo' && <th className="no-print">Ações</th>}
                </tr>
              </thead>
              <tbody>
                {(result.rows || []).map((row, idx) => {
                  const cancelled =
                    String(row.status || row.status_label || '')
                      .toLowerCase()
                      .includes('cancel');
                  return (
                    <tr key={rowSaleId(row) ?? idx} style={cancelled ? { opacity: 0.85 } : undefined}>
                      {displayColumns.map((col) => (
                        <td key={col}>
                          {col === 'status_label' && cancelled ? (
                            <strong>CANCELADA</strong>
                          ) : (
                            formatCell(col, row[col], result.id)
                          )}
                        </td>
                      ))}
                      {result.id === 'vendas_periodo' && (
                        <td className="row-actions no-print">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={actionBusyId === rowSaleId(row)}
                            onClick={() => void openSaleAction(row, 'detail')}
                          >
                            VER DETALHES
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={actionBusyId === rowSaleId(row)}
                            onClick={() => void openSaleAction(row, 'receipt')}
                          >
                            IMPRIMIR COMPROVANTE
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {(result.rows || []).length === 0 && (
                  <tr>
                    <td colSpan={Math.max(displayColumns.length + (result.id === 'vendas_periodo' ? 1 : 0), 1)}>
                      Sem dados no período.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detailSale && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Detalhes da venda">
          <div className="modal modal-wide" style={{ width: 'min(720px, 100%)' }}>
            <h3>Detalhes — {detailSale.sale_number}</h3>
            <p className="muted-line">Somente consulta. A venda original não é alterada.</p>
            <div className="form-grid" style={{ marginBottom: 12 }}>
              <div>
                <strong>Número</strong>
                <div>{detailSale.sale_number}</div>
              </div>
              <div>
                <strong>Data/hora</strong>
                <div>{detailSale.created_at}</div>
              </div>
              <div>
                <strong>Cliente</strong>
                <div>{detailSale.customer?.name || detailSale.customer_name || '—'}</div>
              </div>
              <div>
                <strong>Situação</strong>
                <div>{detailSale.status === 'cancelled' ? 'CANCELADA' : 'Concluída'}</div>
              </div>
              <div>
                <strong>Desconto</strong>
                <div>{formatBRL(detailSale.discount_cents)}</div>
              </div>
              <div>
                <strong>Total</strong>
                <div>{formatBRL(detailSale.total_cents)}</div>
              </div>
              <div className="span-2">
                <strong>Pagamento</strong>
                <div>
                  {(detailSale.payments || [])
                    .map((p) => `${paymentLabel(p.method, p.card_type)} (${formatBRL(p.amount_cents)})`)
                    .join(' + ') || paymentLabel(detailSale.payment_method) || '—'}
                </div>
              </div>
            </div>
            <table className="product-table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Qtd</th>
                  <th>Preço unit.</th>
                  <th>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {(detailSale.items || []).map((it) => (
                  <tr key={it.id}>
                    <td>
                      {it.name}
                      {it.is_misc ? ' (Diversos)' : ''}
                    </td>
                    <td>{it.quantity}</td>
                    <td>{formatBRL(it.unit_price_cents)}</td>
                    <td>{formatBRL(it.line_total_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setDetailSale(null)}>
                Fechar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setReceiptSale(detailSale);
                  setDetailSale(null);
                }}
              >
                IMPRIMIR COMPROVANTE
              </button>
            </div>
          </div>
        </div>
      )}

      {receiptSale && (
        <ReceiptModal sale={receiptSale} onClose={() => setReceiptSale(null)} />
      )}
    </section>
  );
}
