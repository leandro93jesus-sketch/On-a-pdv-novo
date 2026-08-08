import { AppError } from './errors.js';

/**
 * Normaliza valores monetários legados (reais) para centavos inteiros.
 * Aceita: 19.90 | "19.90" | "19,90" | "R$ 19,90"
 */
export function reaisToCents(value, field = 'valor') {
  if (value == null || value === '') {
    throw new AppError(`${field} é obrigatório`, { status: 400, code: 'INVALID_MONEY' });
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value * 100);
  }

  let s = String(value).trim().replace(/R\$\s?/gi, '').replace(/\s/g, '');
  if (!s) {
    throw new AppError(`${field} é obrigatório`, { status: 400, code: 'INVALID_MONEY' });
  }

  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }

  const n = Number(s);
  if (!Number.isFinite(n)) {
    throw new AppError(`${field} monetário inválido: ${value}`, {
      status: 400,
      code: 'INVALID_MONEY',
      details: { value },
    });
  }
  return Math.round(n * 100);
}

export function parseLegacyMoneyToCents(value, { field = 'valor', required = false } = {}) {
  if (value == null || value === '') {
    if (required) {
      throw new AppError(`${field} é obrigatório`, { status: 400, code: 'INVALID_MONEY' });
    }
    return null;
  }
  return reaisToCents(value, field);
}
