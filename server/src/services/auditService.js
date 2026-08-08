import { getDb } from '../db/index.js';
import { getCurrentOperator } from './settingsService.js';

export function writeAudit({
  action,
  entityType,
  entityId = null,
  details = null,
  userName = null,
  userId = null,
  result = 'ok',
}) {
  const db = getDb();
  // Compatível com schema pré e pós Etapa 4
  const cols = db.prepare(`PRAGMA table_info(audit_logs)`).all().map((c) => c.name);
  const hasUserId = cols.includes('user_id');
  const hasResult = cols.includes('result');

  if (hasUserId && hasResult) {
    db.prepare(
      `INSERT INTO audit_logs (action, entity_type, entity_id, details, user_name, user_id, result)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      action,
      entityType,
      entityId,
      details == null ? null : typeof details === 'string' ? details : JSON.stringify(details),
      userName || getCurrentOperator(),
      userId,
      result || 'ok'
    );
    return;
  }

  db.prepare(
    `INSERT INTO audit_logs (action, entity_type, entity_id, details, user_name)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    action,
    entityType,
    entityId,
    details == null ? null : typeof details === 'string' ? details : JSON.stringify(details),
    userName || getCurrentOperator()
  );
}

export function listAuditLogs({
  limit = 100,
  offset = 0,
  action = null,
  userName = null,
  from = null,
  to = null,
} = {}) {
  const where = [];
  const params = [];
  if (action) {
    where.push('action LIKE ?');
    params.push(`%${action}%`);
  }
  if (userName) {
    where.push('user_name LIKE ?');
    params.push(`%${userName}%`);
  }
  if (from) {
    where.push('created_at >= ?');
    params.push(from);
  }
  if (to) {
    where.push('created_at <= ?');
    params.push(`${to} 23:59:59`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(
      `SELECT * FROM audit_logs ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, Math.min(Number(limit) || 100, 500), Number(offset) || 0);
  return rows.map((r) => ({
    ...r,
    details: (() => {
      try {
        return r.details ? JSON.parse(r.details) : null;
      } catch {
        return r.details;
      }
    })(),
  }));
}
