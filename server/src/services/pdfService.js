import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import PDFDocument from 'pdfkit';
import { getSaleById } from './salesService.js';
import { getDeliveryOrder } from './deliveryOrdersService.js';
import { getCompanyForReceipt } from './settingsAppService.js';
import { readLogoBuffer } from './logoService.js';
import { getCurrentOperator } from './settingsService.js';
import { getDb } from '../db/index.js';
import { getDataDir, getReceiptsDir, ensureDataDir } from '../db/paths.js';
import { AppError } from '../utils/errors.js';

function brl(cents) {
  return (Number(cents || 0) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

export function paymentLabelForPdf(method, cardType) {
  if (method === 'cartao') {
    const t = cardType ? String(cardType).toUpperCase() : '';
    if (t === 'CREDIT') return 'Cartão Crédito';
    if (t === 'DEBIT') return 'Cartão Débito';
    return 'Cartão';
  }
  const map = {
    dinheiro: 'Dinheiro',
    pix: 'Pix',
    cartao_credito: 'Cartão Crédito',
    cartao_debito: 'Cartão Débito',
    crediario: 'Crediário',
  };
  return map[method] || method || '—';
}

function sanitizeFilePart(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function saleSeqFromNumber(saleNumber) {
  const m = String(saleNumber || '').match(/(\d+)\s*$/);
  return m ? m[1].padStart(6, '0') : String(saleNumber || '000000').replace(/\D/g, '').padStart(6, '0').slice(-6);
}

function splitDateTime(createdAt) {
  const raw = String(createdAt || '');
  const [datePart, timePart] = raw.includes('T') ? raw.split('T') : raw.split(' ');
  return {
    date: (datePart || '').slice(0, 10),
    time: (timePart || '').slice(0, 8) || '—',
  };
}

function resolveOperator(sale) {
  if (sale?.cash_session_id) {
    try {
      const row = getDb()
        .prepare('SELECT operator_name FROM cash_sessions WHERE id = ?')
        .get(sale.cash_session_id);
      if (row?.operator_name) return row.operator_name;
    } catch {
      /* ignore */
    }
  }
  return getCurrentOperator();
}

function drawBrandHeader(doc, company, logo, documentTitle) {
  if (logo?.buffer) {
    try {
      const logoW = 72;
      const x = (doc.page.width - logoW) / 2;
      doc.image(logo.buffer, x, doc.y, { width: logoW, height: 72, fit: [72, 72], align: 'center' });
      doc.moveDown(0.6);
    } catch {
      /* logo inválido */
    }
  }
  const title = company.store_trade_name || company.store_name || 'ONÇA PRODUTOS DE LIMPEZA';
  doc.fontSize(16).fillColor('#0f3d2e').text(title, { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(12).fillColor('#1a2433').text(documentTitle, { align: 'center' });
  doc.fontSize(9).fillColor('#5b6b7c').text('Documento não fiscal', { align: 'center' });
  doc.moveDown(0.8);
  if (company.store_document) {
    doc.fontSize(9).fillColor('#1a2433').text(`CNPJ/CPF: ${company.store_document}`);
  }
  if (company.store_address) doc.text(`Endereço: ${company.store_address}`);
  if (company.store_phone) doc.text(`Telefone: ${company.store_phone}`);
  doc.moveDown(0.6);
}

function drawItemsTable(doc, items) {
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#d0d9e3').stroke();
  doc.moveDown(0.4);
  doc.fontSize(9).fillColor('#5b6b7c');
  const y0 = doc.y;
  doc.text('Produto', 48, y0, { width: 260 });
  doc.text('Qtd', 320, y0, { width: 40, align: 'right' });
  doc.text('Unit.', 370, y0, { width: 70, align: 'right' });
  doc.text('Total', 450, y0, { width: 90, align: 'right' });
  doc.moveDown(0.3);
  doc.moveTo(48, doc.y).lineTo(547, doc.y).stroke();
  doc.moveDown(0.3);
  doc.fillColor('#1a2433');
  for (const item of items || []) {
    const y = doc.y;
    const name = item.is_misc ? `${item.name} (Diversos)` : item.name;
    doc.text(name, 48, y, { width: 260 });
    doc.text(String(item.quantity), 320, y, { width: 40, align: 'right' });
    doc.text(brl(item.unit_price_cents), 370, y, { width: 70, align: 'right' });
    doc.text(brl(item.line_total_cents), 450, y, { width: 90, align: 'right' });
    doc.moveDown(0.35);
  }
}

/**
 * Caminho organizado: comprovantes/YYYY/MM/ONCA-VENDA-000154[-CLIENTE].pdf
 * Relativo ao data dir (portátil).
 */
export function buildSaleReceiptFilename(sale) {
  const seq = saleSeqFromNumber(sale.sale_number);
  const client = sanitizeFilePart(sale.customer?.name || sale.customer_name || '');
  return client ? `ONCA-VENDA-${seq}-${client}.pdf` : `ONCA-VENDA-${seq}.pdf`;
}

export function resolveSaleReceiptPath(sale) {
  ensureDataDir();
  const { date } = splitDateTime(sale.created_at);
  const [year, month] = (date || new Date().toISOString().slice(0, 10)).split('-');
  const dir = join(getReceiptsDir(), year || '0000', month || '00');
  mkdirSync(dir, { recursive: true });
  const filename = buildSaleReceiptFilename(sale);
  const absolutePath = join(dir, filename);
  const relativePath = relative(getDataDir(), absolutePath).split('\\').join('/');
  return { absolutePath, relativePath, filename, dir };
}

/**
 * Gera PDF de COMPROVANTE DE VENDA (não é NF-e).
 * Retorna Buffer — não altera venda/caixa/estoque.
 */
export async function buildSaleReceiptPdf(saleId) {
  const sale = getSaleById(saleId);
  if (!sale) throw new AppError('Venda não encontrada', { status: 404, code: 'NOT_FOUND' });
  const company = getCompanyForReceipt();
  const logo = readLogoBuffer();
  const operator = resolveOperator(sale);
  const { date, time } = splitDateTime(sale.created_at);
  const phone = sale.customer?.whatsapp || sale.customer?.phone || null;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawBrandHeader(doc, company, logo, 'COMPROVANTE DE VENDA');

    doc.fontSize(10).fillColor('#1a2433');
    doc.text(`Número: ${sale.sale_number}`);
    doc.text(`Data: ${date}`);
    doc.text(`Hora: ${time}`);
    doc.text(`Status: ${sale.status === 'cancelled' ? 'Cancelada' : 'Concluída'}`);
    doc.text(`Operador: ${operator}`);
    if (sale.customer?.name) doc.text(`Cliente: ${sale.customer.name}`);
    if (phone) doc.text(`Telefone: ${phone}`);
    doc.moveDown(0.5);

    drawItemsTable(doc, sale.items);

    doc.moveDown(0.3);
    doc.moveTo(48, doc.y).lineTo(547, doc.y).stroke();
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#1a2433');
    doc.text(`Subtotal: ${brl(sale.subtotal_cents)}`, { align: 'right' });
    doc.text(`Desconto: ${brl(sale.discount_cents)}`, { align: 'right' });
    doc.fontSize(12).fillColor('#0f3d2e').text(`TOTAL: ${brl(sale.total_cents)}`, { align: 'right' });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#1a2433');
    const payments = sale.payments || [];
    if (payments.length === 0) {
      doc.text('Forma de pagamento: —', { align: 'right' });
    } else if (payments.length === 1) {
      doc.text(
        `Forma de pagamento: ${paymentLabelForPdf(payments[0].method, payments[0].card_type)} — ${brl(payments[0].amount_cents)}`,
        { align: 'right' }
      );
    } else {
      doc.text('Formas de pagamento:', { align: 'right' });
      for (const p of payments) {
        doc.text(
          `${paymentLabelForPdf(p.method, p.card_type)} ........ ${brl(p.amount_cents)}`,
          { align: 'right' }
        );
      }
      doc.text(`Total ........... ${brl(sale.total_cents)}`, { align: 'right' });
    }
    if ((sale.amount_received_cents || 0) > 0) {
      doc.text(`Valor recebido: ${brl(sale.amount_received_cents)}`, { align: 'right' });
    }
    if ((sale.change_cents || 0) > 0) {
      doc.text(`Troco: ${brl(sale.change_cents)}`, { align: 'right' });
    }
    if (sale.notes) {
      doc.moveDown(0.5);
      doc.text(`Observações: ${sale.notes}`);
    }
    doc.moveDown(1);
    doc
      .fontSize(9)
      .fillColor('#5b6b7c')
      .text(company.receipt_message || 'Obrigado pela preferência!', { align: 'center' });
    doc.end();
  });
}

/**
 * Gera e salva o PDF no disco (ou regenera se ausente).
 * NÃO altera caixa/estoque/pagamento/número da venda.
 */
export async function ensureSaleReceiptPdfFile(saleId, { force = false } = {}) {
  const sale = getSaleById(saleId);
  const paths = resolveSaleReceiptPath(sale);
  let regenerated = false;
  if (!force && existsSync(paths.absolutePath)) {
    const buffer = readFileSync(paths.absolutePath);
    return {
      ...paths,
      buffer,
      regenerated: false,
      sale_number: sale.sale_number,
      sale_id: sale.id,
    };
  }
  const buffer = await buildSaleReceiptPdf(saleId);
  mkdirSync(dirname(paths.absolutePath), { recursive: true });
  writeFileSync(paths.absolutePath, buffer);
  regenerated = force || true;
  return {
    ...paths,
    buffer,
    regenerated: Boolean(regenerated),
    sale_number: sale.sale_number,
    sale_id: sale.id,
  };
}

/**
 * PDF de PEDIDO DE ENTREGA com pagamento pendente (não é comprovante pago).
 */
export async function buildDeliveryOrderPdf(orderId) {
  const order = getDeliveryOrder(orderId);
  if (!order) throw new AppError('Pedido não encontrado', { status: 404, code: 'ORDER_NOT_FOUND' });

  const paid = order.payment_status === 'pago';
  // Se já pago e vinculado a venda, preferir comprovante da venda
  if (paid && order.sale_id) {
    return buildSaleReceiptPdf(order.sale_id);
  }

  const company = getCompanyForReceipt();
  const logo = readLogoBuffer();
  const pending = !paid;
  const balance = Math.max(0, Number(order.total_cents || 0) - Number(order.amount_paid_cents || 0));
  const address = [
    order.address,
    order.address_number,
    order.neighborhood,
    order.city,
    order.state,
    order.zip_code,
  ]
    .filter(Boolean)
    .join(', ');

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawBrandHeader(
      doc,
      company,
      logo,
      pending ? 'PEDIDO DE ENTREGA' : 'COMPROVANTE DE VENDA'
    );
    if (pending) {
      doc.fontSize(12).fillColor('#7a1c14').text('PAGAMENTO PENDENTE', { align: 'center' });
      doc.moveDown(0.6);
    }

    doc.fontSize(10).fillColor('#1a2433');
    doc.text(`Pedido: ${order.order_number}`);
    doc.text(`Data: ${order.created_at}`);
    doc.text(`Status: ${order.status}`);
    doc.text(`Pagamento: ${order.payment_status}`);
    if (order.customer_name) doc.text(`Cliente: ${order.customer_name}`);
    if (order.phone || order.whatsapp) doc.text(`Telefone: ${order.phone || order.whatsapp}`);
    if (address) doc.text(`Endereço: ${address}`);
    if (order.route_label) doc.text(`Rota: ${order.route_label}`);
    doc.moveDown(0.5);

    drawItemsTable(
      doc,
      (order.items || []).map((i) => ({
        name: i.product_name || i.name,
        quantity: i.quantity,
        unit_price_cents: i.unit_price_cents,
        line_total_cents: i.line_total_cents,
        is_misc: i.is_misc,
      }))
    );

    doc.moveDown(0.3);
    doc.moveTo(48, doc.y).lineTo(547, doc.y).stroke();
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#1a2433');
    doc.text(`Total: ${brl(order.total_cents)}`, { align: 'right' });
    doc.text(`Pago: ${brl(order.amount_paid_cents)}`, { align: 'right' });
    if (pending) {
      doc.fontSize(12).fillColor('#7a1c14').text(`Saldo pendente: ${brl(balance)}`, {
        align: 'right',
      });
    }
    if (order.notes) {
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor('#1a2433').text(`Observações: ${order.notes}`);
    }
    doc.end();
  });
}

export function resolveDeliveryReceiptPath(order) {
  ensureDataDir();
  const { date } = splitDateTime(order.created_at);
  const [year, month] = (date || new Date().toISOString().slice(0, 10)).split('-');
  const dir = join(getReceiptsDir(), year || '0000', month || '00');
  mkdirSync(dir, { recursive: true });
  const seq = saleSeqFromNumber(order.order_number);
  const client = sanitizeFilePart(order.customer_name || '');
  const prefix = order.payment_status === 'pago' ? 'ONCA-VENDA' : 'ONCA-PEDIDO';
  const filename = client ? `${prefix}-${seq}-${client}.pdf` : `${prefix}-${seq}.pdf`;
  const absolutePath = join(dir, filename);
  const relativePath = relative(getDataDir(), absolutePath).split('\\').join('/');
  return { absolutePath, relativePath, filename, dir };
}

export async function ensureDeliveryOrderPdfFile(orderId, { force = false } = {}) {
  const order = getDeliveryOrder(orderId);
  if (order.payment_status === 'pago' && order.sale_id) {
    return ensureSaleReceiptPdfFile(order.sale_id, { force });
  }
  const paths = resolveDeliveryReceiptPath(order);
  if (!force && existsSync(paths.absolutePath)) {
    return {
      ...paths,
      buffer: readFileSync(paths.absolutePath),
      regenerated: false,
      order_number: order.order_number,
      order_id: order.id,
      pending: order.payment_status !== 'pago',
    };
  }
  const buffer = await buildDeliveryOrderPdf(orderId);
  mkdirSync(dirname(paths.absolutePath), { recursive: true });
  writeFileSync(paths.absolutePath, buffer);
  return {
    ...paths,
    buffer,
    regenerated: true,
    order_number: order.order_number,
    order_id: order.id,
    pending: order.payment_status !== 'pago',
  };
}
