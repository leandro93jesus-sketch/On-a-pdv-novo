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
    const err = new Error(`${field} deve ser um inteiro >= 0 (centavos)`);
    err.status = 400;
    err.code = 'INVALID_MONEY';
    throw err;
  }
  return cents;
}
