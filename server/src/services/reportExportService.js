import PDFDocument from 'pdfkit';
import { runReport } from './reportsService.js';
import { getCompanyForReceipt } from './settingsAppService.js';

/**
 * Exportação de relatórios em PDF e CSV.
 * Somente leitura: não altera venda, estoque, caixa nem crediário.
 */

const LABELS = {
  sale_number: 'Nº venda',
  sale_date: 'Data',
  sale_time: 'Hora',
  created_at: 'Data/hora',
  customer_name: 'Cliente',
  operator_name: 'Operador',
  products_summary: 'Produtos',
  items_count: 'Itens',
  subtotal_cents: 'Subtotal',
  discount_cents: 'Desconto',
  total_cents: 'Total',
  payment_methods: 'Pagamento',
  amount_received_cents: 'Recebido',
  change_cents: 'Troco',
  status_label: 'Situação',
  cost_cents: 'Custo',
  profit_cents: 'Lucro',
  sales_count: 'Qtd. vendas',
  cancelled_count: 'Cancelamentos',
  items_sold: 'Itens vendidos',
  gross_cents: 'Faturamento bruto',
  net_cents: 'Faturamento líquido',
  ticket_avg_cents: 'Ticket médio',
};

function label(key) {
  if (LABELS[key]) return LABELS[key];
  return String(key)
    .replace(/_cents$/i, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function brl(cents) {
  return (Number(cents || 0) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function formatValue(key, value) {
  if (value == null || value === '') return '—';
  if (/_cents$/i.test(key)) return brl(value);
  if (key === 'sale_date' && typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  if (key === 'sale_time' && typeof value === 'string') return value.slice(0, 5);
  return String(value);
}

function periodLabel(filters = {}) {
  const period = String(filters.period || filters.periodo || '').toLowerCase();
  if (period === 'hoje' || period === 'today') return 'Hoje';
  if (period === 'ontem' || period === 'yesterday') return 'Ontem';
  const from = filters.from || filters.date_from;
  const to = filters.to || filters.date_to;
  if (from && to) return `${from} a ${to}`;
  if (from) return `a partir de ${from}`;
  if (to) return `até ${to}`;
  return 'todo o período';
}

function activeFilters(filters = {}) {
  const keys = ['customer', 'operator', 'product', 'payment_method', 'status', 'sale_number'];
  return keys
    .filter((k) => filters[k] != null && String(filters[k]).trim() !== '')
    .map((k) => `${label(k)}: ${filters[k]}`);
}

export function buildReportCsv(reportId, filters = {}) {
  const report = runReport(reportId, filters);
  const columns = report.columns || Object.keys(report.rows?.[0] || {});
  const escape = (value) => {
    const raw = value == null ? '' : String(value);
    return /[",;\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
  };

  const lines = [columns.map((c) => escape(label(c))).join(';')];
  for (const row of report.rows || []) {
    lines.push(columns.map((c) => escape(formatValue(c, row[c]))).join(';'));
  }
  if (report.totals) {
    lines.push('');
    lines.push(escape('RESUMO DO PERÍODO'));
    for (const [key, value] of Object.entries(report.totals)) {
      lines.push(`${escape(label(key))};${escape(formatValue(key, value))}`);
    }
  }

  // BOM para o Excel abrir acentuação corretamente.
  return {
    filename: `onca-pdv-${reportId}-${new Date().toISOString().slice(0, 10)}.csv`,
    mime: 'text/csv; charset=utf-8',
    content: `\uFEFF${lines.join('\r\n')}\r\n`,
  };
}

export async function buildReportPdf(reportId, filters = {}) {
  const report = runReport(reportId, filters);
  const company = getCompanyForReceipt();
  const columns = report.columns || Object.keys(report.rows?.[0] || {});

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 32 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = 32;
    const right = doc.page.width - 32;
    const usable = right - left;

    doc.fontSize(14).fillColor('#0f3d2e');
    doc.text(company.store_trade_name || company.store_name || 'ONÇA PRODUTOS DE LIMPEZA', { align: 'center' });
    doc.fontSize(12).fillColor('#1a2433').text(report.title || reportId, { align: 'center' });
    doc.fontSize(9).fillColor('#5b6b7c').text(`Período: ${periodLabel(filters)}`, { align: 'center' });
    const filtersLine = activeFilters(filters);
    if (filtersLine.length) {
      doc.fontSize(8).text(`Filtros — ${filtersLine.join('  •  ')}`, { align: 'center' });
    }
    doc.fontSize(8).text(`Gerado em ${new Date().toLocaleString('pt-BR')}  •  Documento não fiscal`, {
      align: 'center',
    });
    doc.moveDown(0.6);

    if (report.totals) {
      doc.fontSize(9).fillColor('#1a2433');
      const parts = Object.entries(report.totals).map(([k, v]) => `${label(k)}: ${formatValue(k, v)}`);
      doc.text(parts.join('   |   '), left, doc.y, { width: usable });
      doc.moveDown(0.6);
    }

    // Larguras proporcionais: colunas de texto longo ficam maiores.
    const weight = (col) => {
      if (col === 'products_summary') return 3.4;
      if (col === 'customer_name' || col === 'operator_name') return 1.6;
      if (col === 'payment_methods') return 1.4;
      return 1;
    };
    const totalWeight = columns.reduce((a, c) => a + weight(c), 0);
    const widths = columns.map((c) => (weight(c) / totalWeight) * usable);

    const drawRow = (values, { header = false } = {}) => {
      const size = header ? 8 : 8;
      doc.fontSize(size).fillColor(header ? '#5b6b7c' : '#1a2433');
      const y = doc.y;
      let height = 0;
      columns.forEach((col, i) => {
        const x = left + widths.slice(0, i).reduce((a, w) => a + w, 0);
        const text = values[i];
        const opts = { width: widths[i] - 4, align: /_cents$|items/.test(col) ? 'right' : 'left' };
        height = Math.max(height, doc.heightOfString(text, opts));
        doc.text(text, x, y, opts);
      });
      doc.y = y + height + 3;
      doc.moveTo(left, doc.y - 1).lineTo(right, doc.y - 1).strokeColor('#e4eaf1').stroke();
      if (doc.y > doc.page.height - 48) doc.addPage();
    };

    drawRow(columns.map((c) => label(c)), { header: true });
    for (const row of report.rows || []) {
      drawRow(columns.map((c) => formatValue(c, row[c])));
    }
    if (!(report.rows || []).length) {
      doc.fontSize(9).fillColor('#5b6b7c').text('Sem dados no período.', left, doc.y + 4);
    }

    doc.end();
  });
}

export function buildReportPdfFilename(reportId) {
  return `onca-pdv-${reportId}-${new Date().toISOString().slice(0, 10)}.pdf`;
}
