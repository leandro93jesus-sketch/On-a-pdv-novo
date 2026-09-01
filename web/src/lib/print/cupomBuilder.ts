/**
 * Gerador de cupom em texto.
 * Não fala com impressora, banco nem fila — só monta o conteúdo.
 */

export type CupomWidth = '58mm' | '80mm' | 'A4';

export interface CupomLineItem {
  name: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
}

export interface CupomPayment {
  method: string;
  amount_cents: number;
  card_type?: string | null;
}

export interface CupomSaleInput {
  sale_number?: string;
  created_at?: string;
  items?: CupomLineItem[];
  payments?: CupomPayment[];
  subtotal_cents?: number;
  discount_cents?: number;
  total_cents?: number;
  amount_received_cents?: number | null;
  change_cents?: number | null;
}

export interface BuildCupomOptions {
  company?: string;
  width?: CupomWidth;
  reprint?: boolean;
  title?: string;
}

export interface BuiltCupom {
  text: string;
  width: CupomWidth;
  charsPerLine: number;
  lineCount: number;
  hasItems: boolean;
  hasTotal: boolean;
  hasPayment: boolean;
  cut: boolean;
}

const WIDTH_CHARS: Record<CupomWidth, number> = {
  '58mm': 32,
  '80mm': 48,
  A4: 48,
};

export function charsForWidth(width: CupomWidth = '80mm'): number {
  return WIDTH_CHARS[width] || WIDTH_CHARS['80mm'];
}

export function formatMoney(cents: number): string {
  const n = Number.isFinite(cents) ? cents : 0;
  return (n / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function paymentLabel(method?: string | null, cardType?: string | null): string {
  if (method === 'cartao') {
    const t = cardType ? String(cardType).toUpperCase() : '';
    if (t === 'CREDIT') return 'Cartão Crédito';
    if (t === 'DEBIT') return 'Cartão Débito';
    return 'Cartão';
  }
  switch (method) {
    case 'dinheiro':
      return 'Dinheiro';
    case 'pix':
      return 'PIX';
    case 'cartao_credito':
      return 'Cartão Crédito';
    case 'cartao_debito':
      return 'Cartão Débito';
    case 'crediario':
      return 'Crediário';
    default:
      return method ? String(method) : '—';
  }
}

export function wrapLine(text: string, width: number): string[] {
  const raw = String(text || '').replace(/\r/g, '');
  if (!raw) return [''];
  const out: string[] = [];
  for (const paragraph of raw.split('\n')) {
    if (paragraph.length <= width) {
      out.push(paragraph);
      continue;
    }
    let rest = paragraph;
    while (rest.length > width) {
      let cut = rest.lastIndexOf(' ', width);
      if (cut < Math.floor(width / 2)) cut = width;
      out.push(rest.slice(0, cut).trimEnd());
      rest = rest.slice(cut).trimStart();
    }
    if (rest) out.push(rest);
  }
  return out;
}

export function linePair(left: string, right: string, width: number): string {
  const r = String(right);
  const maxLeft = Math.max(1, width - r.length - 1);
  const l = left.length > maxLeft ? `${left.slice(0, Math.max(0, maxLeft - 1))}…` : left;
  const spaces = Math.max(1, width - l.length - r.length);
  return `${l}${' '.repeat(spaces)}${r}`;
}

export function rule(width: number, ch = '-'): string {
  return ch.repeat(width);
}

/** Cupom mínimo do ÚNICO teste físico — curto de propósito. */
export function buildPhysicalTestCupom(width: CupomWidth = '80mm'): BuiltCupom {
  const w = charsForWidth(width);
  const lines = ['ONÇA', 'TESTE DE IMPRESSÃO', rule(w), '', 'IMPRESSORA OK', ''];
  return finalizeCupom(lines.join('\n'), width, { hasItems: false, hasTotal: false, hasPayment: false });
}

export function buildSaleCupom(sale: CupomSaleInput, opts: BuildCupomOptions = {}): BuiltCupom {
  const width = opts.width || '80mm';
  const w = charsForWidth(width);
  const company = (opts.company || 'ONÇA PRODUTOS DE LIMPEZA').trim();
  const items = sale.items || [];
  const payments = sale.payments || [];
  const lines: string[] = [];

  lines.push(...wrapLine(company.toUpperCase(), w));
  if (opts.reprint) lines.push('REIMPRESSÃO');
  lines.push(opts.title || 'COMPROVANTE DE VENDA');
  lines.push(rule(w));
  if (sale.sale_number) lines.push(`Venda: ${sale.sale_number}`);
  if (sale.created_at) lines.push(`Data: ${sale.created_at}`);
  lines.push('');

  for (const item of items) {
    const qty = Number(item.quantity) || 0;
    const name = String(item.name || 'Item').trim() || 'Item';
    const left = `${qty}x ${name}`;
    lines.push(...wrapLine(linePair(left, formatMoney(item.line_total_cents), w), w));
  }

  if (!items.length) {
    lines.push('(sem itens)');
  }

  lines.push(rule(w));
  if (sale.subtotal_cents != null) {
    lines.push(linePair('Subtotal', formatMoney(sale.subtotal_cents), w));
  }
  if (sale.discount_cents) {
    lines.push(linePair('Desconto', formatMoney(sale.discount_cents), w));
  }
  lines.push(linePair('TOTAL', formatMoney(sale.total_cents || 0), w));

  if (payments.length) {
    for (const p of payments) {
      lines.push(linePair(`Pagamento: ${paymentLabel(p.method, p.card_type)}`, formatMoney(p.amount_cents), w));
    }
  } else {
    lines.push('Pagamento: —');
  }

  if (
    sale.amount_received_cents != null &&
    (sale.amount_received_cents > 0 || payments.some((p) => p.method === 'dinheiro'))
  ) {
    lines.push(linePair('Recebido', formatMoney(sale.amount_received_cents || 0), w));
  }
  if (sale.change_cents != null && (sale.change_cents > 0 || payments.some((p) => p.method === 'dinheiro'))) {
    lines.push(linePair('Troco', formatMoney(sale.change_cents || 0), w));
  }

  lines.push(rule(w));
  lines.push('Obrigado e volte sempre');
  lines.push('');

  return finalizeCupom(lines.join('\n'), width, {
    hasItems: items.length > 0,
    hasTotal: sale.total_cents != null,
    hasPayment: payments.length > 0,
  });
}

function finalizeCupom(
  text: string,
  width: CupomWidth,
  flags: { hasItems: boolean; hasTotal: boolean; hasPayment: boolean }
): BuiltCupom {
  const normalized = text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n');
  return {
    text: normalized,
    width,
    charsPerLine: charsForWidth(width),
    lineCount: normalized.split('\n').length,
    hasItems: flags.hasItems,
    hasTotal: flags.hasTotal,
    hasPayment: flags.hasPayment,
    cut: true,
  };
}
