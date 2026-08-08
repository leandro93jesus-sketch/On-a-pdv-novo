import PDFDocument from 'pdfkit';
import { getSaleById } from './salesService.js';
import { getCompanyForReceipt } from './settingsAppService.js';
import { readLogoBuffer } from './logoService.js';
import { AppError } from '../utils/errors.js';

function brl(cents) {
  return (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function paymentLabel(method) {
  const map = { dinheiro: 'Dinheiro', pix: 'Pix', cartao: 'Cartão', crediario: 'Crediário' };
  return map[method] || method;
}

/**
 * Gera PDF profissional de COMPROVANTE DE VENDA (não é NF-e).
 * Retorna Buffer.
 */
export async function buildSaleReceiptPdf(saleId) {
  const sale = getSaleById(saleId);
  if (!sale) throw new AppError('Venda não encontrada', { status: 404, code: 'NOT_FOUND' });
  const company = getCompanyForReceipt();
  const logo = readLogoBuffer();

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    if (logo?.buffer) {
      try {
        const logoW = 72;
        const x = (doc.page.width - logoW) / 2;
        doc.image(logo.buffer, x, doc.y, { width: logoW, height: 72, fit: [72, 72], align: 'center' });
        doc.moveDown(0.6);
      } catch {
        /* logo inválido — segue só com texto */
      }
    }

    const title = company.store_trade_name || company.store_name || 'ONÇA PRODUTOS DE LIMPEZA';
    doc.fontSize(16).fillColor('#0f3d2e').text(title, { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(11).fillColor('#1a2433').text('COMPROVANTE DE VENDA', { align: 'center' });
    doc.fontSize(9).fillColor('#5b6b7c').text('Documento não fiscal', { align: 'center' });
    doc.moveDown(0.8);

    if (company.store_document) doc.fontSize(9).fillColor('#1a2433').text(`CNPJ/CPF: ${company.store_document}`);
    if (company.store_address) doc.text(`Endereço: ${company.store_address}`);
    if (company.store_phone) doc.text(`Telefone: ${company.store_phone}`);
    doc.moveDown(0.6);

    doc.fontSize(10).fillColor('#1a2433');
    doc.text(`Número: ${sale.sale_number}`);
    doc.text(`Data/Hora: ${sale.created_at}`);
    doc.text(`Status: ${sale.status === 'cancelled' ? 'Cancelada' : 'Concluída'}`);
    if (sale.customer?.name) doc.text(`Cliente: ${sale.customer.name}`);
    doc.moveDown(0.5);

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
    for (const item of sale.items || []) {
      const y = doc.y;
      const name = item.is_misc ? `${item.name} (Diversos)` : item.name;
      doc.text(name, 48, y, { width: 260 });
      doc.text(String(item.quantity), 320, y, { width: 40, align: 'right' });
      doc.text(brl(item.unit_price_cents), 370, y, { width: 70, align: 'right' });
      doc.text(brl(item.line_total_cents), 450, y, { width: 90, align: 'right' });
      doc.moveDown(0.35);
    }

    doc.moveDown(0.3);
    doc.moveTo(48, doc.y).lineTo(547, doc.y).stroke();
    doc.moveDown(0.5);
    doc.fontSize(10);
    doc.text(`Subtotal: ${brl(sale.subtotal_cents)}`, { align: 'right' });
    doc.text(`Desconto: ${brl(sale.discount_cents)}`, { align: 'right' });
    doc.fontSize(12).fillColor('#0f3d2e').text(`TOTAL: ${brl(sale.total_cents)}`, { align: 'right' });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#1a2433');
    for (const p of sale.payments || []) {
      doc.text(`Pagamento: ${paymentLabel(p.method)} — ${brl(p.amount_cents)}`, { align: 'right' });
    }
    if (sale.notes) {
      doc.moveDown(0.5);
      doc.text(`Observações: ${sale.notes}`);
    }
    doc.moveDown(1);
    doc.fontSize(9).fillColor('#5b6b7c').text(company.receipt_message || 'Obrigado pela preferência!', {
      align: 'center',
    });
    doc.end();
  });
}
