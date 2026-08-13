const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findSidecarBackups, isSqliteFile } = require('./sidecarBackup.cjs');

test('findSidecarBackups encontra onca-pdv-backup-*.db ao lado do exe', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onca-sidecar-'));
  try {
    const dbPath = path.join(dir, 'onca-pdv-backup-2026-08-12-182432.db');
    // header SQLite mínimo + padding
    const buf = Buffer.alloc(200, 0);
    buf.write('SQLite format 3\0', 0, 'utf8');
    fs.writeFileSync(dbPath, buf);
    fs.writeFileSync(
      path.join(dir, 'onca-pdv-backup-2026-08-12-182432.manifest.json'),
      JSON.stringify({
        format: 'onca-pdv-backup-v1',
        app_version: '1.2.4',
        size_bytes: 200,
        sha256: 'x',
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
