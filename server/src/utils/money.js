import { AppError } from './errors.js';

/** Arredonda valor já em centavos para inteiro seguro (evita 19.899999). */
export function toCents(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value + Number.EPSILON);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.round(n + Number.EPSILON);
  }
  return null;
}

/** Converte valor monetário BRL/pt-BR ou número para centavos. */
export function parseMoneyToCents(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Se já parece centavos inteiros grandes, não assumir — tratar como reais
    return Math.round((value + Number.EPSILON) * 100);
  }
  let s = String(value).trim();
  if (!s) return null;
  s = s.replace(/R\$\s?/gi, '').replace(/\s/g, '');
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round((n + Number.EPSILON) * 100);
}

export function assertNonNegativeCents(value, field) {
  const cents = toCents(value);
  if (cents === null || !Number.isInteger(cents) || cents < 0) {
    throw new AppError(`${field} deve ser um inteiro >= 0 (centavos)`, {
      status: 400,
      code: 'INVALID_MONEY',
    });
  }
  return cents;
}

export function roundCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n + Number.EPSILON);
}
