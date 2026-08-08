import Database from 'better-sqlite3';
import { ensureDataDir, getDbPath } from './paths.js';
import { runMigrations } from './migrate.js';

let dbInstance = null;

export function openDatabase(dbPath = getDbPath()) {
  ensureDataDir();
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  runMigrations(db);
  return db;
}

export function getDb() {
  if (!dbInstance) {
    dbInstance = openDatabase();
  }
  return dbInstance;
}

export function setDb(db) {
  dbInstance = db;
}

export function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
