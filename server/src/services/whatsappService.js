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

  const encoded = encodeURIComponent(text);
  const url = number
    ? `https://wa.me/${number}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`;

  return {
    sale_id: sale.id,
    sale_number: sale.sale_number,
    phone: number,
    message: text,
    url,
    pdf_attached: false,
    note:
      'O WhatsApp Web/App não permite anexar o PDF automaticamente na maioria dos ambientes. Gere o PDF e anexe manualmente se necessário.',
  };
}
