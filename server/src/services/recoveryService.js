import { getDb } from '../db/index.js';
import { writeAudit } from './auditService.js';

/** Marca operações 'started' órfãs como failed no boot (queda/crash). */
export function recoverIncompleteOperations() {
  const db = getDb();
  const stale = db
    .prepare(`SELECT id, op_key, op_type, started_at FROM operation_journal WHERE status = 'started'`)
    .all();
  if (!stale.length) {
    return { recovered: 0, items: [] };
  }
  const upd = db.prepare(
    `UPDATE operation_journal SET status = 'failed', error_message = ?, finished_at = datetime('now') WHERE id = ?`
  );
  for (const row of stale) {
    upd.run('Interrompida por queda/fechamento inesperado', row.id);
  }
  writeAudit({
    action: 'recovery.incomplete_ops',
    entityType: 'operation_journal',
    details: { count: stale.length, keys: stale.map((s) => s.op_key) },
    userName: 'system',
  });
  return { recovered: stale.length, items: stale };
}

export function beginOperation(opKey, opType, payload = {}) {
  const db = getDb();
  try {
    db.prepare(
      `INSERT INTO operation_journal (op_key, op_type, status, payload_json)
       VALUES (?, ?, 'started', ?)`
    ).run(String(opKey), String(opType), JSON.stringify(payload || {}));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      const existing = db
        .prepare(`SELECT status FROM operation_journal WHERE op_key = ?`)
        .get(String(opKey));
      if (existing?.status === 'committed') {
        return { duplicate: true, status: 'committed' };
      }
    }
    throw err;
  }
  return { duplicate: false, status: 'started' };
}

export function commitOperation(opKey) {
  getDb()
    .prepare(
      `UPDATE operation_journal SET status = 'committed', finished_at = datetime('now') WHERE op_key = ? AND status = 'started'`
    )
    .run(String(opKey));
}

export function failOperation(opKey, errorMessage) {
  getDb()
    .prepare(
      `UPDATE operation_journal SET status = 'failed', error_message = ?, finished_at = datetime('now') WHERE op_key = ? AND status = 'started'`
    )
    .run(String(errorMessage || 'erro'), String(opKey));
}
