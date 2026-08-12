import { getSetting } from './settingsService.js';
import { getSaleById } from './salesService.js';
import { getDeliveryOrder } from './deliveryOrdersService.js';
import { AppError } from '../utils/errors.js';

function digitsOnly(phone) {
  return String(phone || '').replace(/\D/g, '');
}

/**
 * Normaliza para wa.me (Brasil: adiciona 55 se necessário).
 */
export function normalizeWhatsAppNumber(phone) {
  let d = digitsOnly(phone);
  if (!d) return null;
  if (d.length <= 11) d = `55${d}`;
  return d;
}

/**
 * Monta URL genérica do WhatsApp Web/App com mensagem (reutilizável).
 */
export function buildWhatsAppUrl({ phone, message } = {}) {
  const number = normalizeWhatsAppNumber(phone);
  const text = String(message || '').trim();
  if (!text) {
    throw new AppError('Mensagem vazia', { status: 400, code: 'EMPTY_MESSAGE' });
  }
  const encoded = encodeURIComponent(text);
  const url = number
    ? `https://wa.me/${number}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`;
  return { phone: number, message: text, url };
}

const MANUAL_ATTACH_NOTE =
  'PDF GERADO COM SUCESSO. O WhatsApp Web/Desktop não permite anexar o arquivo automaticamente neste ambiente. Abra o PDF ou a pasta e anexe o comprovante na conversa.';

/**
 * Monta URL do WhatsApp com frase curta.
 * NÃO lista produtos — o conteúdo principal é o PDF gerado.
 * pdf_attached permanece false (limitação da plataforma).
 */
export function buildWhatsAppShare({ saleId, phone, message, pdfMeta } = {}) {
  const sale = getSaleById(saleId);
  if (!sale) throw new AppError('Venda não encontrada', { status: 404, code: 'NOT_FOUND' });

  const number =
    normalizeWhatsAppNumber(phone) ||
    normalizeWhatsAppNumber(sale.customer?.whatsapp) ||
    normalizeWhatsAppNumber(sale.customer?.phone);

  const defaultMsg = getSetting(
    'whatsapp_default_message',
    'Olá! Segue o comprovante da sua compra na Onça Produtos de Limpeza.'
  );
  const fileHint = pdfMeta?.filename ? `\nArquivo: ${pdfMeta.filename}` : '';
  const text =
    message?.trim() ||
    `${defaultMsg}\n\nComprovante: ${sale.sale_number}${fileHint}\n(Anexe o PDF do comprovante nesta conversa.)`;

  const built = buildWhatsAppUrl({ phone: number, message: text });

  return {
    sale_id: sale.id,
    sale_number: sale.sale_number,
    phone: built.phone,
    message: built.message,
    url: built.url,
    pdf_attached: false,
    note: MANUAL_ATTACH_NOTE,
  };
}

/**
 * Compartilhamento WhatsApp de pedido de entrega (rota/endereço).
 * Não altera pagamento, caixa nem estoque.
 */
export function buildDeliveryOrderWhatsAppShare({
  order,
  phone,
  message,
  recipient = 'outro',
} = {}) {
  if (!order) throw new AppError('Pedido não encontrado', { status: 404, code: 'ORDER_NOT_FOUND' });
  const built = buildWhatsAppUrl({ phone, message });
  return {
    order_id: order.id,
    order_number: order.order_number,
    recipient,
    phone: built.phone,
    message: built.message,
    url: built.url,
    financial_impact: false,
  };
}

/**
 * WhatsApp para documento PDF do pedido (pendente ou pago).
 * Sem lista de produtos na mensagem.
 */
export function buildDeliveryOrderDocumentWhatsAppShare({
  orderId,
  phone,
  message,
  pdfMeta,
} = {}) {
  const order = getDeliveryOrder(orderId);
  if (!order) throw new AppError('Pedido não encontrado', { status: 404, code: 'ORDER_NOT_FOUND' });

  const number =
    normalizeWhatsAppNumber(phone) ||
    normalizeWhatsAppNumber(order.whatsapp) ||
    normalizeWhatsAppNumber(order.phone);

  const pending = order.payment_status !== 'pago';
  const defaultMsg = pending
    ? 'Olá! Segue o pedido de entrega da Onça Produtos de Limpeza (pagamento pendente).'
    : 'Olá! Segue o comprovante da sua compra na Onça Produtos de Limpeza.';
  const fileHint = pdfMeta?.filename ? `\nArquivo: ${pdfMeta.filename}` : '';
  const text =
    message?.trim() ||
    `${defaultMsg}\n\nPedido: ${order.order_number}${fileHint}\n(Anexe o PDF nesta conversa.)`;

  const built = buildWhatsAppUrl({ phone: number, message: text });
  return {
    order_id: order.id,
    order_number: order.order_number,
    phone: built.phone,
    message: built.message,
    url: built.url,
    pdf_attached: false,
    pending,
    note: MANUAL_ATTACH_NOTE,
    financial_impact: false,
  };
}
