import { getDb, closeDb } from './index.js';
import { getAppliedMigrations, listMigrationFiles } from './migrate.js';
import { getDbPath } from './paths.js';

const db = getDb();
const applied = getAppliedMigrations(db);
const all = listMigrationFiles();

console.log(`[onca-pdv] banco: ${getDbPath()}`);
console.log(`[onca-pdv] migrations: ${applied.size}/${all.length} aplicadas`);
for (const name of all) {
  console.log(`  ${applied.has(name) ? '✓' : '·'} ${name}`);
}
closeDb();
