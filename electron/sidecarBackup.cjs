/**
 * Detecção de backup .db ao lado do instalador/executável (pendrive).
 * Nunca importa automaticamente — só localiza e valida candidatos.
 * O banco NÃO deve ser usado diretamente do pendrive: sempre copiar para userData.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

function isSqliteFile(filePath) {
  try {
    const st = fs.statSync(filePath);
    if (st.size < 100) return false;
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    return buf.toString('utf8').startsWith('SQLite format 3');
  } catch {
    return false;
  }
}

function readManifestBeside(dbPath) {
  const dir = path.dirname(dbPath);
  const base = path.basename(dbPath, path.extname(dbPath));
  const candidates = [
    path.join(dir, `${base}.manifest.json`),
    path.join(dir, `${base}.manifest`),
    `${dbPath}.manifest.json`,
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      return { path: p, data: JSON.parse(fs.readFileSync(p, 'utf8')) };
    } catch {
      /* ignore */
    }
  }
  return null;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Diretórios onde o backup do pendrive/instalador pode aparecer.
 * NÃO inclui caminhos fixos de desenvolvimento.
 */
function listSearchDirs({
  execPath,
  appPath,
  resourcesPath,
  cwd,
  userData,
  extraDirs = [],
} = {}) {
  const out = [];
  const add = (p) => {
    if (!p) return;
    const resolved = path.resolve(p);
    // Bloqueia caminhos típicos do ambiente de build/dev do agente
    const lower = resolved.toLowerCase();
    if (lower.includes(`${path.sep}opt${path.sep}cursor`)) return;
    if (lower.includes(`${path.sep}.cursor${path.sep}`)) return;
    if (!out.includes(resolved)) out.push(resolved);
  };

  for (const d of extraDirs) add(d);
  if (userData) {
    add(path.join(userData, 'ONCA-PDV', 'sidecar-from-installer'));
    add(path.join(userData, 'ONCA-PDV', 'sidecar-import'));
  }
  if (execPath) add(path.dirname(execPath));
  if (appPath) add(path.dirname(appPath));
  if (resourcesPath) {
    add(path.dirname(resourcesPath));
  }
  if (cwd) add(cwd);
  // Pasta atual (útil para portátil / pasta do Setup.exe quando lançado dali)
  try {
    add(process.cwd());
  } catch {
    /* ignore */
  }
  return out;
}

function findSidecarBackups(opts = {}) {
  const dirs = listSearchDirs(opts);
  const found = [];
  const seen = new Set();

  for (const dir of dirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!/^onca-pdv-backup-.*\.(db|sqlite|sqlite3)$/i.test(name)) continue;
      const full = path.join(dir, name);
      if (seen.has(full)) continue;
      if (!isSqliteFile(full)) continue;
      seen.add(full);
      const st = fs.statSync(full);
      const manifest = readManifestBeside(full);
      found.push({
        path: full,
        filename: name,
        size_bytes: st.size,
        mtime: st.mtime.toISOString(),
        mtimeMs: st.mtimeMs,
        manifest_path: manifest?.path || null,
        manifest: manifest?.data || null,
        app_version: manifest?.data?.app_version || null,
        sha256_expected: manifest?.data?.sha256 || null,
        size_expected: manifest?.data?.size_bytes || null,
        source_dir: dir,
      });
    }
  }

  found.sort((a, b) => b.mtimeMs - a.mtimeMs || b.size_bytes - a.size_bytes);
  return found;
}

/**
 * Valida backup com Node embutido (integrity_check + manifesto/SHA).
 */
function resolveServerRoot() {
  const candidates = [
    process.env.PDV_SERVER_ROOT,
    typeof process.resourcesPath === 'string'
      ? path.join(process.resourcesPath, 'app-server')
      : null,
    path.join(__dirname, '..', 'desktop-resources', 'app-server'),
    path.join(__dirname, '..', 'server'),
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'node_modules', 'better-sqlite3'))) return c;
    if (fs.existsSync(path.join(c, 'package.json'))) return c;
  }
  return process.cwd();
}

function validateSidecarBackup(dbPath, { nodeBinary, cliScript, serverRoot } = {}) {
  const script =
    cliScript ||
    path.join(__dirname, 'validateSqliteCli.cjs');
  if (!nodeBinary || !fs.existsSync(nodeBinary)) {
    // Fallback mínimo sem integrity_check profundo
    if (!isSqliteFile(dbPath)) {
      return {
        ok: false,
        code: 'BACKUP_INVALID',
        message: 'BACKUP ENCONTRADO, MAS NÃO PÔDE SER VALIDADO.',
      };
    }
    const manifest = readManifestBeside(dbPath);
    const sha = sha256File(dbPath);
    if (manifest?.data?.sha256 && String(manifest.data.sha256).toLowerCase() !== sha) {
      return {
        ok: false,
        code: 'BACKUP_HASH_MISMATCH',
        message: 'BACKUP ENCONTRADO, MAS NÃO PÔDE SER VALIDADO (SHA-256).',
      };
    }
    return {
      ok: true,
      path: dbPath,
      filename: path.basename(dbPath),
      size_bytes: fs.statSync(dbPath).size,
      mtime: fs.statSync(dbPath).mtime.toISOString(),
      sha256: sha,
      integrity_check: 'skipped',
      foreign_key_check: 'skipped',
      counts: {},
      last_sale_at: null,
      app_version: manifest?.data?.app_version || null,
      manifest_present: Boolean(manifest),
      shallow: true,
    };
  }

  const cwd = serverRoot || resolveServerRoot();
  const r = spawnSync(nodeBinary, [script, dbPath], {
    encoding: 'utf8',
    cwd,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      NODE_PATH: path.join(cwd, 'node_modules'),
    },
    timeout: 60000,
  });
  const out = String(r.stdout || '').trim();
  let parsed = null;
  try {
    parsed = JSON.parse(out.split('\n').filter(Boolean).pop() || '{}');
  } catch {
    return {
      ok: false,
      code: 'BACKUP_INVALID',
      message: 'BACKUP ENCONTRADO, MAS NÃO PÔDE SER VALIDADO.',
      stderr: String(r.stderr || '').slice(0, 500),
    };
  }
  if (!parsed.ok) {
    return {
      ok: false,
      code: parsed.code || 'BACKUP_INVALID',
      message: parsed.message || 'BACKUP ENCONTRADO, MAS NÃO PÔDE SER VALIDADO.',
      details: parsed,
    };
  }
  return parsed;
}

function stampCompact(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(
    d.getMinutes()
  )}${pad(d.getSeconds())}`;
}

/**
 * Copia backup do pendrive/instalador para o diretório persistente do PC.
 * Nunca deixa o app apontando para o arquivo no pendrive.
 */
function copySidecarToPersistent(sourceDb, targetDb, { makePreRestore = true } = {}) {
  const targetDir = path.dirname(targetDb);
  const backupsDir = path.join(targetDir, 'backups');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(backupsDir, { recursive: true });

  let preRestore = null;
  if (makePreRestore && fs.existsSync(targetDb) && fs.statSync(targetDb).size > 100) {
    preRestore = path.join(backupsDir, `ONCA-PDV-PRE-RESTAURACAO-${stampCompact()}.db`);
    fs.copyFileSync(targetDb, preRestore);
    if (!fs.existsSync(preRestore) || fs.statSync(preRestore).size <= 0) {
      throw new Error('FALHA AO CRIAR BACKUP DO BANCO ATUAL (PRE-RESTAURACAO)');
    }
  }

  const tmp = `${targetDb}.sidecar-tmp`;
  fs.copyFileSync(sourceDb, tmp);
  if (!isSqliteFile(tmp)) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw new Error('FALHA AO COPIAR BANCO — cópia inválida');
  }
  // remove wal/shm do destino
  for (const side of [`${targetDb}-wal`, `${targetDb}-shm`]) {
    if (fs.existsSync(side)) {
      try {
        fs.unlinkSync(side);
      } catch {
        /* ignore */
      }
    }
  }
  if (fs.existsSync(targetDb)) fs.unlinkSync(targetDb);
  fs.renameSync(tmp, targetDb);

  // Copia manifesto se existir (opcional)
  const manifest = readManifestBeside(sourceDb);
  if (manifest?.path) {
    const destManifest = targetDb.replace(/\.db$/i, '.manifest.json');
    try {
      fs.copyFileSync(manifest.path, destManifest);
    } catch {
      /* ignore */
    }
  }

  return {
    source: sourceDb,
    destination: targetDb,
    pre_restore: preRestore,
    size_bytes: fs.statSync(targetDb).size,
  };
}

function summarizeDbFile(dbPath, { nodeBinary, cliScript } = {}) {
  if (!dbPath || !fs.existsSync(dbPath)) {
    return { exists: false, path: dbPath, counts: {}, last_sale_at: null };
  }
  const v = validateSidecarBackup(dbPath, { nodeBinary, cliScript });
  if (!v.ok) {
    return {
      exists: true,
      path: dbPath,
      counts: {},
      last_sale_at: null,
      error: v.message,
    };
  }
  return {
    exists: true,
    path: dbPath,
    filename: v.filename,
    size_bytes: v.size_bytes,
    mtime: v.mtime,
    counts: v.counts || {},
    last_sale_at: v.last_sale_at || null,
    app_version: v.app_version || null,
  };
}

module.exports = {
  isSqliteFile,
  readManifestBeside,
  listSearchDirs,
  findSidecarBackups,
  validateSidecarBackup,
  copySidecarToPersistent,
  summarizeDbFile,
  sha256File,
  stampCompact,
};
