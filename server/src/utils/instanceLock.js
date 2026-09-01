import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getDataDir, ensureDataDir } from '../db/paths.js';

function lockPath() {
  ensureDataDir();
  return join(getDataDir(), 'onca-pdv.instance.lock');
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Garante uma única instância do servidor usando o mesmo banco/data dir.
 * Em teste, não bloqueia.
 */
export function acquireInstanceLock() {
  if (process.env.NODE_ENV === 'test' || process.env.PDV_ALLOW_MULTI === '1') {
    return () => {};
  }
  mkdirSync(getDataDir(), { recursive: true });
  const path = lockPath();
  if (existsSync(path)) {
    const prev = Number(String(readFileSync(path, 'utf8')).trim());
    if (pidAlive(prev) && prev !== process.pid) {
      const err = new Error('ONÇA PDV já está em execução.');
      err.code = 'INSTANCE_ALREADY_RUNNING';
      throw err;
    }
  }
  writeFileSync(path, String(process.pid), 'utf8');
  const release = () => {
    try {
      if (existsSync(path)) {
        const cur = Number(String(readFileSync(path, 'utf8')).trim());
        if (cur === process.pid) unlinkSync(path);
      }
    } catch {
      /* ignore */
    }
  };
  process.once('exit', release);
  process.once('SIGINT', () => {
    release();
    process.exit(0);
  });
  process.once('SIGTERM', () => {
    release();
    process.exit(0);
  });
  return release;
}
