import type { Product } from '../../api/client';

export type PaymentMethod = 'dinheiro' | 'pix' | 'cartao';

export interface CartLine {
  key: string;
  productId: number | null;
  name: string;
  barcode: string | null;
  unitPriceCents: number;
  quantity: number;
  discountCents: number;
  isMisc: boolean;
  stockQty: number | null;
  allowNegative: boolean;
}

export function lineTotal(line: CartLine): number {
  return line.unitPriceCents * line.quantity - line.discountCents;
}

export function productToLine(product: Product, quantity = 1): CartLine {
  return {
    key: `p-${product.id}`,
    productId: product.id,
    name: product.name,
    barcode: product.barcode,
    unitPriceCents: product.price_cents,
    quantity,
    discountCents: 0,
    isMisc: false,
    stockQty: product.stock_qty,
    allowNegative: Boolean(product.allow_negative_stock),
  };
}

export function miscLine(name: string, unitPriceCents: number, quantity = 1): CartLine {
  return {
    key: `misc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    productId: null,
    name: name.trim() || 'Item Diversos',
    barcode: null,
    unitPriceCents,
    quantity,
    discountCents: 0,
    isMisc: true,
    stockQty: null,
    allowNegative: true,
  };
}
