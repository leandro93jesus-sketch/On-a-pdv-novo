/**
 * Trava contra cupom vazio. Sem conteúdo válido, NÃO imprimir.
 */

export const EMPTY_CUPOM_MESSAGE = 'IMPRESSÃO CANCELADA\nO cupom não foi gerado corretamente.';

export const MIN_CUPOM_CHARS = 20;

export function validateCupomText(text: unknown): { ok: true; text: string } | { ok: false; error: string } {
  if (typeof text !== 'string') {
    return { ok: false, error: EMPTY_CUPOM_MESSAGE };
  }
  const trimmed = text.replace(/\u00a0/g, ' ').trim();
  if (!trimmed || trimmed.length < MIN_CUPOM_CHARS) {
    return { ok: false, error: EMPTY_CUPOM_MESSAGE };
  }
  const withoutRules = trimmed.replace(/[-_=*.\s]/g, '');
  if (withoutRules.length < 8) {
    return { ok: false, error: EMPTY_CUPOM_MESSAGE };
  }
  return { ok: true, text: trimmed };
}

export function assertCupomReady(text: unknown): string {
  const check = validateCupomText(text);
  if (!check.ok) {
    const err = new Error(check.error);
    err.name = 'EmptyCupomError';
    throw err;
  }
  return check.text;
}
