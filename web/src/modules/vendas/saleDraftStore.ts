import type { Customer } from '../../api/client';
import type { DeliveryAddressFormValue } from '../entregas/DeliveryAddressForm';
import type { MixedAmounts } from './MixedPaymentModal';
import type { CardType } from './CardPaymentModal';
import type { CartLine, PaymentMethod } from './types';

const STORAGE_KEY = 'onca_pdv_open_sale_draft_v1';
const TEMP_KEY = 'onca_pdv_open_sale_draft_v1.tmp';

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

/** Um rascunho só é aceito se tiver a forma esperada; qualquer desvio é descartado. */
export function isValidDraftShape(value: unknown): value is SaleDraft {
  if (!value || typeof value !== 'object') return false;
  const d = value as Partial<SaleDraft>;
  if (d.version !== 1) return false;
  if (!Array.isArray(d.cart)) return false;
  return d.cart.every(
    (line) =>
      line != null &&
      typeof line === 'object' &&
      typeof (line as CartLine).name === 'string' &&
      Number.isFinite((line as CartLine).quantity) &&
      Number.isFinite((line as CartLine).unitPriceCents)
  );
}

/**
 * Lê o rascunho salvo. Se o conteúdo estiver corrompido ou incompleto, registra o
 * erro, remove o arquivo inválido e devolve null — o PDV abre normalmente.
 */
export function loadPersistedDraft(): SaleDraft | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    console.warn('[onca-pdv] rascunho de venda inacessível; abrindo venda vazia.', err);
    return null;
  }
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isValidDraftShape(parsed)) {
      console.warn('[onca-pdv] rascunho de venda inválido foi ignorado e descartado.');
      clearDraft();
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn('[onca-pdv] rascunho de venda corrompido foi ignorado e descartado.', err);
    clearDraft();
    return null;
  }
}

/** Resumo mostrado na tela de recuperação: horário, itens e valor aproximado. */
export function draftSummary(draft: SaleDraft): {
  itemCount: number;
  unitCount: number;
  approxTotalCents: number;
  time: string;
} {
  const itemCount = draft.cart.length;
  const unitCount = draft.cart.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
  const approxTotalCents = draft.cart.reduce(
    (sum, l) => sum + (Number(l.unitPriceCents) || 0) * (Number(l.quantity) || 0) - (Number(l.discountCents) || 0),
    0
  );
  let time = '—';
  const parsed = new Date(draft.updatedAt);
  if (!Number.isNaN(parsed.getTime())) {
    time = parsed.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  return { itemCount, unitCount, approxTotalCents: Math.max(0, approxTotalCents), time };
}

/**
 * Grava o rascunho. A escrita é feita numa chave temporária e só então promovida
 * para a chave definitiva, para que uma queda no meio da gravação não deixe o
 * rascunho oficial pela metade.
 */
export function saveDraft(draft: SaleDraft): void {
  memoryDraft = draft;
  try {
    const serialized = JSON.stringify(draft);
    localStorage.setItem(TEMP_KEY, serialized);
    localStorage.setItem(STORAGE_KEY, serialized);
    localStorage.removeItem(TEMP_KEY);
  } catch {
    // quota / private mode — memória ainda preserva na sessão
  }
}

export function clearDraft(): void {
  memoryDraft = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TEMP_KEY);
  } catch {
    // ignore
  }
}
