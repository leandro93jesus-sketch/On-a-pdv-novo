#!/usr/bin/env node
/**
 * Simula pasta de pendrive: Setup ao lado de onca-pdv-backup-*.db
 * Valida detecção, integrity, cópia para "PC" e independência da pasta origem.
 */
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  existsSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {
  findSidecarBackups,
  validateSidecarBackup,
  copySidecarToPersistent,
} = require(join(root, 'electron/sidecarBackup.cjs'));

const sourceDb = join(root, 'server/data/onca-pdv.db');
if (!existsSync(sourceDb)) {
  console.error('REPROVADO: banco fonte ausente em server/data/onca-pdv.db');
  process.exit(1);
}

const usb = mkdtempSync(join(tmpdir(), 'onca-usb-'));
const pc = mkdtempSync(join(tmpdir(), 'onca-pc-'));
const report = { steps: [] };

try {
  // Nome do backup real esperado pelo usuário
  const bakName = 'onca-pdv-backup-2026-08-12-182432.db';
  const bakPath = join(usb, bakName);
  copyFileSync(sourceDb, bakPath);
  const sha = createHash('sha256').update(readFileSync(bakPath)).digest('hex');
  const size = readFileSync(bakPath).length;
  writeFileSync(
    join(usb, 'onca-pdv-backup-2026-08-12-182432.manifest.json'),
    JSON.stringify(
      {
        format: 'onca-pdv-backup-v1',
        created_at: new Date().toISOString(),
        app_version: '1.2.4',
        db_schema_version: '020_delivery_address_route.sql',
        db_filename: bakName,
        size_bytes: size,
        sha256: sha,
        kind: 'manual',
        notes: 'Fixture de fluxo pendrive (cópia do banco do ambiente — arquivo 182432 real não enviado)',
      },
      null,
      2
    )
  );
  // Fake "exe" na mesma pasta
  writeFileSync(join(usb, 'ONCA-PDV-Setup-test.exe'), 'fake-setup');

  const found = findSidecarBackups({
    execPath: join(usb, 'ONCA-PDV-Setup-test.exe'),
    cwd: usb,
    userData: pc,
  });
  report.steps.push({ step: 'detect', ok: found.length >= 1, file: found[0]?.filename });
  if (!found.length) throw new Error('Backup não detectado ao lado do EXE');

  const nodeBin = process.execPath;
  const validation = validateSidecarBackup(found[0].path, {
    nodeBinary: nodeBin,
    cliScript: join(root, 'electron/validateSqliteCli.cjs'),
    serverRoot: join(root, 'server'),
  });
  report.steps.push({
    step: 'validate',
    ok: validation.ok === true,
    integrity: validation.integrity_check,
    manifest: validation.manifest_present,
    counts: validation.counts,
  });
  if (!validation.ok) throw new Error(validation.message);

  const targetDb = join(pc, 'ONCA-PDV', 'onca-pdv.db');
  const copied = copySidecarToPersistent(found[0].path, targetDb, { makePreRestore: false });
  report.steps.push({
    step: 'copy_to_pc',
    ok: existsSync(targetDb),
    destination: copied.destination,
  });

  const post = validateSidecarBackup(targetDb, {
    nodeBinary: nodeBin,
    cliScript: join(root, 'electron/validateSqliteCli.cjs'),
    serverRoot: join(root, 'server'),
  });
  report.steps.push({
    step: 'validate_copied',
    ok: post.ok === true && post.integrity_check === 'ok',
    path: targetDb,
  });

  // Remove "pendrive" e revalida cópia local
  rmSync(usb, { recursive: true, force: true });
  const afterUnplug = validateSidecarBackup(targetDb, {
    nodeBinary: nodeBin,
    cliScript: join(root, 'electron/validateSqliteCli.cjs'),
    serverRoot: join(root, 'server'),
  });
  report.steps.push({
    step: 'works_after_unplug',
    ok: afterUnplug.ok === true,
    path: targetDb,
    counts: afterUnplug.counts,
  });

  // Simula instalador: copia para sidecar-from-installer
  const usb2 = mkdtempSync(join(tmpdir(), 'onca-usb2-'));
  const bak2 = join(usb2, bakName);
  copyFileSync(targetDb, bak2);
  const incoming = join(pc, 'ONCA-PDV', 'sidecar-from-installer');
  mkdirSync(incoming, { recursive: true });
  copyFileSync(bak2, join(incoming, bakName));
  const foundIncoming = findSidecarBackups({
    execPath: join(pc, 'ProgramFiles', 'ONCA-PDV', 'ONÇA PDV.exe'),
    userData: pc,
    cwd: join(pc, 'ProgramFiles', 'ONCA-PDV'),
  });
  report.steps.push({
    step: 'detect_from_installer_staging',
    ok: foundIncoming.some((f) => f.path.includes('sidecar-from-installer')),
    count: foundIncoming.length,
  });
  rmSync(usb2, { recursive: true, force: true });

  const allOk = report.steps.every((s) => s.ok);
  report.status = allOk ? 'APROVADO_FLUXO' : 'REPROVADO';
  report.note =
    'Arquivo onca-pdv-backup-2026-08-12-182432.db real do usuário NÃO estava no ambiente; fluxo testado com cópia válida do banco local + manifesto coerente.';
  console.log(JSON.stringify(report, null, 2));
  if (!allOk) process.exit(1);
} catch (err) {
  console.error(err);
  console.log(JSON.stringify({ status: 'REPROVADO', error: String(err.message || err), report }, null, 2));
  process.exit(1);
} finally {
  try {
    rmSync(pc, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
