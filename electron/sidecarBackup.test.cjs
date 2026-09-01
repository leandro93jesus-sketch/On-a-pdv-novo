const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {
  findSidecarBackups,
  isSqliteFile,
  copySidecarToPersistent,
  validateSidecarBackup,
} = require('./sidecarBackup.cjs');

test('findSidecarBackups encontra onca-pdv-backup-*.db ao lado do exe', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onca-sidecar-'));
  try {
    const dbPath = path.join(dir, 'onca-pdv-backup-2026-08-12-182432.db');
    const buf = Buffer.alloc(200, 0);
    buf.write('SQLite format 3\0', 0, 'utf8');
    fs.writeFileSync(dbPath, buf);
    fs.writeFileSync(
      path.join(dir, 'onca-pdv-backup-2026-08-12-182432.manifest.json'),
      JSON.stringify({
        format: 'onca-pdv-backup-v1',
        app_version: '1.2.4',
        size_bytes: 200,
        sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      })
    );

    const fakeExe = path.join(dir, 'ONCA-PDV.exe');
    fs.writeFileSync(fakeExe, 'x');

    assert.equal(isSqliteFile(dbPath), true);
    const found = findSidecarBackups({ execPath: fakeExe, cwd: dir });
    assert.ok(found.length >= 1);
    assert.equal(found[0].filename, 'onca-pdv-backup-2026-08-12-182432.db');
    assert.equal(found[0].app_version, '1.2.4');
    assert.ok(found[0].manifest_path);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('copySidecarToPersistent não depende da pasta origem depois', () => {
  const usb = fs.mkdtempSync(path.join(os.tmpdir(), 'onca-usb-'));
  const pc = fs.mkdtempSync(path.join(os.tmpdir(), 'onca-pcdata-'));
  try {
    const src = path.join(usb, 'onca-pdv-backup-demo.db');
    const real = path.join(__dirname, '..', 'server', 'data', 'onca-pdv.db');
    fs.copyFileSync(real, src);
    const dest = path.join(pc, 'ONCA-PDV', 'onca-pdv.db');
    const copied = copySidecarToPersistent(src, dest, { makePreRestore: false });
    assert.equal(copied.destination, dest);
    assert.ok(fs.existsSync(dest));
    fs.rmSync(usb, { recursive: true, force: true });
    assert.ok(fs.existsSync(dest), 'cópia local deve sobreviver sem pendrive');
  } finally {
    try {
      fs.rmSync(pc, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

test('validateSidecarBackup com Node + better-sqlite3', () => {
  const real = path.join(__dirname, '..', 'server', 'data', 'onca-pdv.db');
  const v = validateSidecarBackup(real, {
    nodeBinary: process.execPath,
    cliScript: path.join(__dirname, 'validateSqliteCli.cjs'),
    serverRoot: path.join(__dirname, '..', 'server'),
  });
  assert.equal(v.ok, true, v.message || 'validação');
  assert.equal(v.integrity_check, 'ok');
});
