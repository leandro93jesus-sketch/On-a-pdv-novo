/**
 * Detecção opcional de backup .db ao lado do instalador/executável.
 * Nunca importa automaticamente — só localiza candidatos.
 */
const fs = require('fs');
const path = require('path');

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

function listSearchDirs({ execPath, appPath, resourcesPath, cwd } = {}) {
  const out = [];
  const add = (p) => {
    if (p && !out.includes(p)) out.push(p);
  };
  if (execPath) add(path.dirname(execPath));
  if (appPath) add(path.dirname(appPath));
  if (resourcesPath) {
    add(resourcesPath);
    add(path.dirname(resourcesPath));
  }
  if (cwd) add(cwd);
  // Pasta atual e pai (portátil / pasta do instalador)
  add(process.cwd());
  try {
    add(path.dirname(process.cwd()));
  } catch {
    /* ignore */
  }
  return out;
}

/**
 * Procura onca-pdv-backup-*.db (e opcionalmente manifesto) ao lado do app/instalador.
 */
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
      if (!/^onca-pdv-backup-.*\.db$/i.test(name) && !/^ONCA-PDV-PRE-ATUALIZACAO-.*\.db$/i.test(name)) {
        // Aceita também nomes comuns de backup do app
        if (!/^onca-pdv-backup-.*\.sqlite$/i.test(name)) continue;
      }
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
        manifest_path: manifest?.path || null,
        manifest: manifest?.data || null,
        app_version: manifest?.data?.app_version || null,
        sha256_expected: manifest?.data?.sha256 || null,
        size_expected: manifest?.data?.size_bytes || null,
      });
    }
  }

  found.sort((a, b) => Date.parse(b.mtime) - Date.parse(a.mtime) || b.size_bytes - a.size_bytes);
  return found;
}

module.exports = {
  isSqliteFile,
  readManifestBeside,
  listSearchDirs,
  findSidecarBackups,
};
