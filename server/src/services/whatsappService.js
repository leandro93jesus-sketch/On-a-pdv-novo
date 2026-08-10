import { getSetting } from './settingsService.js';
import { getSaleById } from './salesService.js';
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

/**
 * Monta URL do WhatsApp Web/App com mensagem.
 * Não anexa PDF automaticamente — a plataforma geralmente não permite.
 */
export function buildWhatsAppShare({ saleId, phone, message } = {}) {
  const sale = getSaleById(saleId);
  if (!sale) throw new AppError('Venda não encontrada', { status: 404, code: 'NOT_FOUND' });

  const number =
    normalizeWhatsAppNumber(phone) ||
    normalizeWhatsAppNumber(sale.customer?.whatsapp) ||
    normalizeWhatsAppNumber(sale.customer?.phone);

  const defaultMsg = getSetting(
    'whatsapp_default_message',
    'Olá! Segue o comprovante da sua compra na Onça Produtos de Limpeza. Obrigado pela preferência.'
  );
  const text =
    message?.trim() ||
    `${defaultMsg}\n\nComprovante: ${sale.sale_number}\nTotal: R$ ${(sale.total_cents / 100).toFixed(2).replace('.', ',')}`;

  const built = buildWhatsAppUrl({ phone: number, message: text });

  return {
    sale_id: sale.id,
    sale_number: sale.sale_number,
    phone: built.phone,
    message: built.message,
    url: built.url,
    pdf_attached: false,
    note:
      'O WhatsApp Web/App não permite anexar o PDF automaticamente na maioria dos ambientes. Gere o PDF e anexe manualmente se necessário.',
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
