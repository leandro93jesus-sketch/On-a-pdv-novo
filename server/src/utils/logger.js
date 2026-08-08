import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { getLogsDir, ensureDataDir } from '../db/paths.js';

const MAX_BYTES = 5 * 1024 * 1024;
const KEEP_FILES = 5;

function stamp() {
  return new Date().toISOString();
}

function logFile() {
  ensureDataDir();
  return join(getLogsDir(), 'onca-pdv.log');
}

function rotateIfNeeded(file) {
  try {
    if (!existsSync(file)) return;
    if (statSync(file).size < MAX_BYTES) return;
    const rotated = `${file}.${Date.now()}`;
    renameSync(file, rotated);
    const dir = getLogsDir();
    const files = readdirSync(dir)
      .filter((f) => f.startsWith('onca-pdv.log.'))
      .map((f) => ({ f, m: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    for (const extra of files.slice(KEEP_FILES)) {
      try {
        unlinkSync(join(dir, extra.f));
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

function sanitize(obj) {
  const clone = { ...obj };
  for (const k of Object.keys(clone)) {
    if (/pass|senha|password|pin|token|secret/i.test(k)) clone[k] = '[redacted]';
  }
  return clone;
}

function write(level, message, meta) {
  const line = JSON.stringify({
    t: stamp(),
    level,
    msg: String(message),
    ...(meta && typeof meta === 'object' ? { meta: sanitize(meta) } : {}),
  });
  try {
    const file = logFile();
    mkdirSync(getLogsDir(), { recursive: true });
    rotateIfNeeded(file);
    appendFileSync(file, `${line}\n`, 'utf8');
  } catch {
    /* ignore */
  }
  if (level === 'error') console.error(`[onca-pdv] ${message}`);
  else if (process.env.PDV_LOG_CONSOLE === '1') console.log(`[onca-pdv] ${message}`);
}

export const logger = {
  info: (msg, meta) => write('info', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
};
