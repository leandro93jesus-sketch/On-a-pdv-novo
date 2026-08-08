import { getDb } from '../db/index.js';
import { getCurrentOperator } from './settingsService.js';

export function writeAudit({ action, entityType, entityId = null, details = null, userName = null }) {
  const db = getDb();
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
