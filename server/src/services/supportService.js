import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { getDb } from '../db/index.js';
import { getDataDir, getDbPath, getBackupsDir, getConfigDir } from '../db/paths.js';
import { APP_NAME, APP_VERSION, APP_BUILD } from '../version.js';
import { getSetting } from './settingsService.js';

function runCmd(cmd, args, timeoutMs = 5000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 512 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, stdout: String(stdout || ''), stderr: String(stderr || err.message || '') });
        return;
      }
      resolve({ ok: true, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

async function linuxHostDiagnostics() {
  if (process.platform !== 'linux') {
    return { platform: process.platform, linux: false };
  }
  let distro = '';
  try {
    const osRelease = readFileSync('/etc/os-release', 'utf8');
    const pretty = osRelease.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
    distro = pretty?.[1] || '';
  } catch {
    distro = '';
  }
  const whichLpstat = await runCmd('which', ['lpstat'], 3000);
  const whichLp = await runCmd('which', ['lp'], 3000);
  const whichBt = await runCmd('which', ['bluetoothctl'], 3000);
  let cupsActive = false;
  let cupsRaw = '';
  if (whichLpstat.ok) {
    const st = await runCmd('lpstat', ['-r'], 5000);
    cupsRaw = (st.stdout || st.stderr || '').trim();
    cupsActive = /scheduler is running/i.test(cupsRaw);
  }
  let defaultPrinter = null;
  let printersCount = 0;
  if (whichLpstat.ok && cupsActive) {
    const p = await runCmd('lpstat', ['-p'], 5000);
    printersCount = (p.stdout.match(/^printer\s+/gim) || []).length;
    const d = await runCmd('lpstat', ['-d'], 4000);
    const m = d.stdout.match(/system default destination:\s*(\S+)/i);
    if (m) defaultPrinter = m[1];
  }
  let dataWritable = false;
  try {
    const test = join(getDataDir(), '.write-test');
    writeFileSync(test, 'ok');
    unlinkSync(test);
    dataWritable = true;
  } catch {
    dataWritable = false;
  }
  return {
    platform: 'linux',
    linux: true,
    distribution: distro,
    arch: process.arch,
    home: homedir(),
    data_dir_writable: dataWritable,
    cups: {
      lpstat: whichLpstat.ok,
      lp: whichLp.ok,
      active: cupsActive,
      status_raw: cupsRaw || null,
      printers_count: printersCount,
      default_printer: defaultPrinter,
      message: whichLpstat.ok
        ? cupsActive
          ? 'CUPS ATIVO'
          : 'CUPS INATIVO'
        : 'Sistema de impressão CUPS não está disponível.',
      hint: whichLpstat.ok
        ? null
        : 'Pacote típico: cups (ex.: sudo apt install cups). O PDV não instala automaticamente.',
    },
    bluetoothctl: whichBt.ok ? 'DISPONÍVEL' : 'INDISPONÍVEL',
    config_dir: getConfigDir(),
  };
}

export async function getSupportDiagnostics() {
  const db = getDb();
  db.pragma('foreign_keys = ON');
  const integrity = db.pragma('integrity_check')[0]?.integrity_check || 'error';
  const fk = db.pragma('foreign_key_check');
  const schemaVersion = db
    .prepare(`SELECT name FROM schema_migrations ORDER BY id DESC LIMIT 1`)
    .get()?.name;

  let lastBackup = null;
  const backupsDir = getBackupsDir();
  if (existsSync(backupsDir)) {
    const files = readdirSync(backupsDir)
      .filter((f) => f.endsWith('.db'))
      .map((f) => {
        const p = join(backupsDir, f);
        const st = statSync(p);
        return { filename: f, path: p, size_bytes: st.size, mtime: st.mtime.toISOString() };
      })
      .sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
    lastBackup = files[0] || null;
  }

  const counts = {
    products: db.prepare(`SELECT COUNT(*) c FROM products`).get().c,
    customers: db.prepare(`SELECT COUNT(*) c FROM customers`).get().c,
    sales: db.prepare(`SELECT COUNT(*) c FROM sales`).get().c,
    users: db.prepare(`SELECT COUNT(*) c FROM users`).get().c,
  };

  let linux = null;
  try {
    linux = await linuxHostDiagnostics();
  } catch {
    linux = { platform: process.platform, error: 'Falha ao coletar diagnóstico Linux' };
  }

  return {
    app_name: APP_NAME,
    app_version: APP_VERSION,
    app_build: APP_BUILD,
    db_schema_version: schemaVersion || getSetting('db_schema_version', ''),
    db_path: getDbPath(),
    data_dir: getDataDir(),
    integrity_check: integrity,
    foreign_key_violations: fk.length,
    last_backup: lastBackup,
    counts,
    generated_at: new Date().toISOString(),
    os: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
    },
    linux_print: linux,
  };
}

/** Relatório de diagnóstico sem senhas. */
export async function buildDiagnosticReport() {
  const base = await getSupportDiagnostics();
  const db = getDb();
  const migrations = db.prepare(`SELECT id, name, applied_at FROM schema_migrations ORDER BY id`).all();
  const settingsSafe = db
    .prepare(`SELECT key, value FROM settings WHERE key NOT LIKE '%password%' AND key NOT LIKE '%secret%' AND key NOT LIKE '%token%' ORDER BY key`)
    .all();
  const recentErrors = db
    .prepare(
      `SELECT id, action, entity_type, created_at, details
       FROM audit_logs
       WHERE action LIKE '%fail%' OR action LIKE '%error%' OR action LIKE '%rollback%'
       ORDER BY id DESC LIMIT 20`
    )
    .all();

  return {
    ...base,
    migrations,
    settings: settingsSafe,
    recent_failures: recentErrors,
    note: 'Relatório sem senhas, tokens ou hashes.',
  };
}
