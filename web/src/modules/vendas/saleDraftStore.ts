import type { Customer } from '../../api/client';
import type { DeliveryAddressFormValue } from '../entregas/DeliveryAddressForm';
import type { MixedAmounts } from './MixedPaymentModal';
import type { CardType } from './CardPaymentModal';
import type { CartLine, PaymentMethod } from './types';

const STORAGE_KEY = 'onca_pdv_open_sale_draft_v1';

export type SaleMode = 'normal' | 'entrega';

export type SaleDraft = {
  version: 1;
  updatedAt: string;
  saleMode: SaleMode;
  cart: CartLine[];
  customer: Customer | null;
  discountInput: string;
  payment: PaymentMethod;
  cardType: CardType | null;
  cashReceivedInput: string;
  creditEntryInput: string;
  creditInstallments: number;
  creditFirstDue: string;
  mixedDraft: MixedAmounts | null;
  deliveryAddr: DeliveryAddressFormValue;
};

/** Estado em memória: sobrevive à desmontagem do React na mesma sessão SPA. */
let memoryDraft: SaleDraft | null = null;

export function hasOpenSaleContent(draft: Pick<SaleDraft, 'cart' | 'customer'> | null | undefined): boolean {
  if (!draft) return false;
  return draft.cart.length > 0 || Boolean(draft.customer);
}

export function getMemoryDraft(): SaleDraft | null {
  return memoryDraft;
}

export function loadPersistedDraft(): SaleDraft | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SaleDraft;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.cart)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDraft(draft: SaleDraft): void {
  memoryDraft = draft;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // quota / private mode — memória ainda preserva na sessão
  }
}

export function clearDraft(): void {
  memoryDraft = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
