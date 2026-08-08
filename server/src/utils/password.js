import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEYLEN = 64;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, KEYLEN).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const hash = scryptSync(String(password), salt, KEYLEN);
  const expected = Buffer.from(String(expectedHash), 'hex');
  if (hash.length !== expected.length) return false;
  return timingSafeEqual(hash, expected);
}

export function hashToken(token) {
  return scryptSync(String(token), 'onca-pdv-session', 32).toString('hex');
}
