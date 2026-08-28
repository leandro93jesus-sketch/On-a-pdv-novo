#!/usr/bin/env node
/**
 * Empacota código-fonte limpo em ONCA-PDV-vX.X.X-FINAL.zip
 * Sem node_modules, sem banco de produção, sem caches.
 */
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
  cpSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash as cryptoHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const outDir = process.env.ONCA_FINAL_OUT || join(root, 'release', 'final');
const folderName = 'ONCA-PDV-FINAL';
const staging = join(outDir, folderName);
const zipName = `ONCA-PDV-v${version}-FINAL.zip`;
const zipPath = join(outDir, zipName);
const shaPath = join(outDir, 'ONCA-PDV-FINAL-SHA256.txt');

const EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  '.cursor',
  'dist',
  'coverage',
  '.vite',
  'playwright-report',
  'test-results',
  '__pycache__',
  '.turbo',
  'final',
]);

const EXCLUDE_FILE_RE = [
  /\.db(-wal|-shm)?$/i,
  /\.log$/i,
  /\.map$/i,
  /^\.DS_Store$/,
  /^Thumbs\.db$/i,
  /\.env(\.|$)/i,
  /\.local$/i,
];

function shouldSkip(relPath, isDir) {
  const parts = relPath.split(/[\\/]/).filter(Boolean);
  if (parts.some((p) => EXCLUDE_DIRS.has(p))) return true;
  if (parts.includes('release') && parts.includes('dist')) return true;
  if (parts.includes('server') && parts.includes('data') && !isDir) {
    // keep data/.gitkeep style empties; skip db/backups/logs
    const base = parts[parts.length - 1];
    if (/\.db/i.test(base) || base.endsWith('.json') && parts.includes('backups')) return true;
    if (parts.includes('backups') || parts.includes('logs') || parts.includes('comprovantes')) return true;
  }
  if (!isDir) {
    const base = parts[parts.length - 1] || '';
    if (EXCLUDE_FILE_RE.some((re) => re.test(base))) return true;
  }
  return false;
}

function copyTree(src, dest, baseRel = '') {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    const from = join(src, name);
    const rel = join(baseRel, name);
    let st;
    try {
      st = statSync(from);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (shouldSkip(rel, true)) continue;
      // skip entire release/dist and large binary dirs
      if (name === 'dist' && baseRel.includes('release')) continue;
      copyTree(from, join(dest, name), rel);
    } else if (st.isFile()) {
      if (shouldSkip(rel, false)) continue;
      mkdirSync(dirname(join(dest, name)), { recursive: true });
      cpSync(from, join(dest, name));
    }
  }
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = cryptoHash('sha256');
    const stream = createReadStream(file);
    stream.on('data', (d) => hash.update(d));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function run(cmd, args, cwd = root) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: process.env });
  if (r.status !== 0) {
    console.error(r.stdout);
    console.error(r.stderr);
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
  }
  return r;
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });

  console.log(`Empacotando ${folderName} v${version}…`);
  // Copiar raiz seletiva
  const topAllow = [
    'package.json',
    'package-lock.json',
    'electron-builder.yml',
    'README.md',
    'AGENTS.md',
    '.gitignore',
    '.npmrc',
    'web',
    'server',
    'electron',
    'scripts',
    'assets',
    'release',
  ];
  for (const name of topAllow) {
    const from = join(root, name);
    if (!existsSync(from)) continue;
    const st = statSync(from);
    if (st.isDirectory()) {
      if (name === 'release') {
        // only changelog/readme from release, not dist binaries
        mkdirSync(join(staging, 'release'), { recursive: true });
        for (const f of ['CHANGELOG.md', 'README.md']) {
          const p = join(root, 'release', f);
          if (existsSync(p)) cpSync(p, join(staging, 'release', f));
        }
      } else {
        copyTree(from, join(staging, name), name);
      }
    } else {
      cpSync(from, join(staging, name));
    }
  }

  // data dir placeholder (sem banco / sem runtime)
  const dataDir = join(staging, 'server', 'data');
  if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, 'README.txt'),
    'Pasta de dados local. O banco onca-pdv.db é criado automaticamente nas migrations ao iniciar o servidor.\nNão versionar .db de produção nesta pasta.\n',
    'utf8'
  );

  // Docs de entrega (podem sobrescrever se já gerados no root out)
  for (const f of ['LEIA-ME.txt', 'TESTES-REALIZADOS.txt', 'ALTERACOES.txt', 'VERSION.txt']) {
    const src = join(outDir, '_docs', f);
    if (existsSync(src)) cpSync(src, join(staging, f));
  }

  // Garantir VERSION.txt
  if (!existsSync(join(staging, 'VERSION.txt'))) {
    writeFileSync(join(staging, 'VERSION.txt'), `ONÇA PDV ${version}\nbuild: ${pkg.build?.extraMetadata?.ONCA_BUILD_ID || ''}\n`, 'utf8');
  }

  if (existsSync(zipPath)) rmSync(zipPath, { force: true });
  run('bash', ['-lc', `cd ${JSON.stringify(outDir)} && zip -r -9 ${JSON.stringify(zipName)} ${JSON.stringify(folderName)} -x '*.DS_Store'`]);

  const hash = await sha256File(zipPath);
  const size = statSync(zipPath).size;
  writeFileSync(
    shaPath,
    `${hash}  ${zipName}\n`,
    'utf8'
  );
  writeFileSync(
    join(outDir, 'ONCA-PDV-FINAL-MANIFEST.json'),
    JSON.stringify({ version, zip: zipName, sha256: hash, bytes: size, folder: folderName }, null, 2) + '\n'
  );
  console.log(`OK ${zipPath}`);
  console.log(`size=${size}`);
  console.log(`sha256=${hash}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
