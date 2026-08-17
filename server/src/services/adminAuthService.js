import { AppError } from '../utils/errors.js';
import { verifyPassword } from '../utils/password.js';
import { getSetting } from './settingsService.js';
import { writeAudit } from './auditService.js';

/**
 * Valida PIN de operação administrativa (alterar/cancelar venda).
 * Nunca registra a senha em logs/auditoria.
 */
export function verifyAdminOperationPin(password) {
  const pin = password == null ? '' : String(password);
  if (!pin) {
    throw new AppError('Senha administrativa obrigatória', {
      status: 401,
      code: 'ADMIN_PIN_REQUIRED',
    });
  }
  const salt = getSetting('admin_op_pin_salt', '');
  const hash = getSetting('admin_op_pin_hash', '');
  if (!salt || !hash) {
    throw new AppError('PIN administrativo não configurado', {
      status: 500,
      code: 'ADMIN_PIN_NOT_CONFIGURED',
    });
  }
  const ok = verifyPassword(pin, salt, hash);
  if (!ok) {
    writeAudit({
      action: 'admin_pin.denied',
      entityType: 'auth',
      entityId: null,
      details: { ok: false },
    });
    throw new AppError('Senha administrativa inválida', {
      status: 401,
      code: 'ADMIN_PIN_INVALID',
    });
  }
  writeAudit({
    action: 'admin_pin.authorized',
    entityType: 'auth',
    entityId: null,
    details: { ok: true, note: 'Administrador autorizou operação sensível' },
  });
  return { ok: true };
}
