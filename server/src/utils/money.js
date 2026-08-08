import { AppError } from './errors.js';

/** Arredonda para centavos inteiros de forma segura. */
export function toCents(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return null;
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
