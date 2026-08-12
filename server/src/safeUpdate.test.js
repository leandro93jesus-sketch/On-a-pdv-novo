import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'onca-safe-update-'));
process.env.NODE_ENV = 'test';
process.env.PDV_DB_PATH = join(tmp, 'onca-pdv.db');
process.env.PDV_DATA_DIR = tmp;
process.env.PDV_SEED = '0';
process.env.PDV_ALLOW_EMPTY_DB = '1';

const { openDatabase, setDb, closeDb } = await import('./db/index.js');
const { runMigrations } = await import('./db/migrate.js');
const {
  prepareDatabaseForOpen,
  createPreUpdateBackup,
  validateSqliteIntegrity,
  countProductionRecords,
  shouldRequireExistingDb,
  hasPriorInstallMarkers,
} = await import('./db/safeUpdate.js');
const { findExistingProductionDb, listDataDirCandidates } = await import('./db/paths.js');

before(() => {
  const db = openDatabase(process.env.PDV_DB_PATH);
  setDb(db);
  runMigrations(db);
  db.prepare(
    `INSERT INTO products (sku, barcode, name, category, price_cents, cost_cents, stock_qty, min_stock_qty, allow_negative_stock, active)
     VALUES ('SKU1', '123', 'Produto Safe', 'Teste', 100, 50, 5, 0, 0, 1)`
  ).run();
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('app_version', '1.2.7')
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run();
});

after(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

test('integrity_check e contagem do banco atual', () => {
  const v = validateSqliteIntegrity(process.env.PDV_DB_PATH, { requireForeignKeysClean: false });
  assert.equal(v.integrity, 'ok');
  const counts = countProductionRecords(process.env.PDV_DB_PATH);
  assert.equal(counts.products, 1);
});

test('backup pré-atualização usa banco ATUAL e nome ONCA-PDV-PRE-ATUALIZACAO', () => {
  const meta = createPreUpdateBackup(process.env.PDV_DB_PATH);
  assert.ok(existsSync(meta.backup_file));
  assert.match(meta.filename, /^ONCA-PDV-PRE-ATUALIZACAO-\d{8}-\d{6}\.db$/);
  assert.equal(meta.integrity_check, 'ok');
  assert.equal(meta.counts_before.products, 1);
  assert.ok(meta.size_bytes > 100);
});

test('prepareDatabaseForOpen faz backup quando versão do app mudou', () => {
  process.env.PDV_FORCE_PRE_UPDATE_BACKUP = '0';
  const prep = prepareDatabaseForOpen();
  assert.equal(prep.mode, 'existing');
  assert.ok(prep.update_plan.versionChanged || prep.preUpdateBackup);
  assert.equal(prep.counts_before.products, 1);
});

test('findExistingProductionDb encontra o banco sem mover', () => {
  const found = findExistingProductionDb();
  assert.ok(found);
  assert.equal(found.path, process.env.PDV_DB_PATH);
});

test('upgrade sem banco e com marcadores exige DB (não cria vazio)', () => {
  const empty = mkdtempSync(join(tmpdir(), 'onca-upgrade-empty-'));
  const prev = {
    NODE_ENV: process.env.NODE_ENV,
    PDV_DB_PATH: process.env.PDV_DB_PATH,
    PDV_DATA_DIR: process.env.PDV_DATA_DIR,
    PDV_ELECTRON_USER_DATA: process.env.PDV_ELECTRON_USER_DATA,
    PDV_ALLOW_EMPTY_DB: process.env.PDV_ALLOW_EMPTY_DB,
    PDV_REQUIRE_EXISTING_DB: process.env.PDV_REQUIRE_EXISTING_DB,
  };
  try {
    process.env.NODE_ENV = 'production';
    process.env.PDV_ELECTRON_USER_DATA = empty;
    process.env.PDV_DATA_DIR = join(empty, 'ONCA-PDV');
    delete process.env.PDV_DB_PATH;
    delete process.env.PDV_ALLOW_EMPTY_DB;
    mkdirSync(join(empty, 'ONCA-PDV', 'backups'), { recursive: true });
    writeFileSync(join(empty, 'ONCA-PDV', 'backups', 'onca-pdv-backup-fake.db'), 'SQLite format 3\0not-real');
    // arquivo fake < 100 bytes para hasPrior — criar um .db maior como marcador
    writeFileSync(
      join(empty, 'ONCA-PDV', 'backups', 'marker.db'),
      Buffer.alloc(200, 1)
    );
    assert.equal(hasPriorInstallMarkers([join(empty, 'ONCA-PDV')]), true);
    process.env.PDV_REQUIRE_EXISTING_DB = '1';
    assert.equal(shouldRequireExistingDb(), true);
  } finally {
    Object.assign(process.env, prev);
    if (prev.PDV_ALLOW_EMPTY_DB == null) delete process.env.PDV_ALLOW_EMPTY_DB;
    if (prev.PDV_REQUIRE_EXISTING_DB == null) delete process.env.PDV_REQUIRE_EXISTING_DB;
    if (prev.PDV_ELECTRON_USER_DATA == null) delete process.env.PDV_ELECTRON_USER_DATA;
    rmSync(empty, { recursive: true, force: true });
  }
});

test('candidatos de data dir não incluem pasta do instalador/resources', () => {
  const dirs = listDataDirCandidates();
  for (const d of dirs) {
    assert.ok(!/resources[/\\]app-server/i.test(d));
    assert.ok(!/app\.asar/i.test(d));
  }
});
