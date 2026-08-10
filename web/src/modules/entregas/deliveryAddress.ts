import type { DeliveryOrder } from '../../api/client';

export type DeliveryAddressFields = {
  zip_code?: string | null;
  address?: string | null;
  address_number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  reference_note?: string | null;
};

export function isDeliveryAddressComplete(addr: DeliveryAddressFields): boolean {
  return Boolean(
    String(addr.address || '').trim() &&
      String(addr.address_number || '').trim() &&
      String(addr.city || '').trim()
  );
}

export function formatDeliveryAddressLines(addr: DeliveryAddressFields): string[] {
  return [
    addr.address ? `Rua: ${addr.address}` : null,
    addr.address_number ? `Número: ${addr.address_number}` : null,
    addr.complement ? `Complemento: ${addr.complement}` : null,
    addr.neighborhood ? `Bairro: ${addr.neighborhood}` : null,
    addr.city || addr.state
      ? `Cidade/UF: ${[addr.city, addr.state].filter(Boolean).join('/')}`
      : null,
    addr.zip_code ? `CEP: ${addr.zip_code}` : null,
    addr.reference_note ? `Referência: ${addr.reference_note}` : null,
  ].filter(Boolean) as string[];
}

export function formatDeliveryAddressOneLine(addr: DeliveryAddressFields): string {
  const parts = [
    addr.address,
    addr.address_number ? `nº ${addr.address_number}` : null,
    addr.complement,
    addr.neighborhood,
    addr.city && addr.state ? `${addr.city}/${addr.state}` : addr.city || addr.state,
    addr.zip_code ? `CEP ${addr.zip_code}` : null,
  ].filter(Boolean);
  return parts.join(', ');
}

export function buildGoogleMapsSearchUrl(addr: DeliveryAddressFields): string | null {
  if (!isDeliveryAddressComplete(addr)) return null;
  const query = [
    addr.address,
    addr.address_number,
    addr.complement,
    addr.neighborhood,
    addr.city,
    addr.state,
    addr.zip_code,
    'Brasil',
  ]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function formatMoneyBRL(cents: number): string {
  return (Number(cents || 0) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

export function deliveryStatusLabel(o: Pick<DeliveryOrder, 'status' | 'payment_status'>): string {
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

export function buildDeliveryRouteWhatsAppMessage(order: DeliveryOrder, mapUrl: string): string {
  const status = deliveryStatusLabel(order);
  const due = Math.max(0, Number(order.total_cents) - Number(order.amount_paid_cents || 0));
  const lines = [
    'ONÇA PRODUTOS DE LIMPEZA',
    '',
    `ENTREGA Nº ${order.order_number}`,
    '',
    `Cliente: ${order.customer_name || '—'}`,
    '',
    'Endereço:',
    formatDeliveryAddressOneLine(order) || '—',
    '',
    `Referência: ${order.reference_note || '—'}`,
    '',
    `Telefone: ${order.phone || '—'}`,
    '',
    `Total do pedido: ${formatMoneyBRL(order.total_cents)}`,
    '',
    `STATUS: ${status}`,
  ];

  if (order.payment_status === 'pagamento_na_entrega' || order.payment_status === 'nao_pago') {
    if (order.payment_status === 'pagamento_na_entrega') {
      lines.push('', 'ATENÇÃO:', `Receber do cliente: ${formatMoneyBRL(due)}`);
      if (order.expected_payment_method) {
        lines.push(`Forma prevista: ${String(order.expected_payment_method).toUpperCase()}`);
      }
      if (
        order.expected_payment_method === 'dinheiro' &&
        order.change_for_cents != null &&
        Number(order.change_for_cents) > 0
      ) {
        lines.push(`Troco para: ${formatMoneyBRL(Number(order.change_for_cents))}`);
      }
    } else if (order.payment_status === 'nao_pago' || order.payment_status === 'pix_pendente') {
      lines.push('', 'ATENÇÃO: Pedido ainda NÃO está pago.');
    }
  }

  lines.push('', 'Rota:', mapUrl);
  if (order.notes) {
    lines.push('', `Observação: ${order.notes}`);
  }
  return lines.join('\n');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fallthrough */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
