import { getDb } from '../db/index.js';

export function getSetting(key, fallback = null) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    )
    .run(key, String(value));
}

export function getTerminalId() {
  return getSetting('terminal_id', 'TERM-1');
}

export function getCurrentOperator() {
  return getSetting('current_operator', 'Operador');
}
