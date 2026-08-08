#!/usr/bin/env node
/**
 * Importação DEFINITIVA autorizada — Oncas PDV v2 → banco principal.
 * Uso: node scripts/import-oncas-v2-real.mjs <arquivo.json> --confirm
 */
import { resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { importOncasPdvV2Real } from '../server/src/services/legacyImport/importOncasPdvV2Real.js';

const args = process.argv.slice(2);
const confirm = args.includes('--confirm');
const jsonArg = args.find((a) => !a.startsWith('--'));
const jsonPath = resolve(
  jsonArg ||
    '/home/ubuntu/.cursor/projects/workspace/uploads/oncas-pdv-backup-2026-08-07-1786145822438_eda5.json'
);

if (!existsSync(jsonPath)) {
  console.error('JSON não encontrado:', jsonPath);
  process.exit(1);
}
if (!confirm) {
  console.error('Recusado: passe --confirm para autorizar a importação definitiva.');
  process.exit(1);
}

mkdirSync(resolve('docs/reports'), { recursive: true });
const reportPath = resolve('docs/reports/IMPORTACAO-REAL-ONCAS-PDV-V2.json');

console.log('=== IMPORTAÇÃO DEFINITIVA ONCAS PDV V2 ===');
console.log('JSON:', jsonPath);
const report = importOncasPdvV2Real(jsonPath, { reportPath, confirm: true });

console.log('Backup segurança:', report.safety_backup.filename);
console.log('SHA-256 JSON:', report.source.sha256);
console.log('Preflight:', report.preflight);
console.log('Demo removido:', report.demo_purge);
console.log('Importado:', report.imported);
console.log('Financeiro:', report.finance);
console.log('Estoque:', report.stock);
console.log('After DB:', report.after_db);
console.log('Validação:', report.validation);
console.log('Relatório:', reportPath);

if (!report.validation.ok) {
  console.error('MIGRAÇÃO NÃO APROVADA — diferenças/erros detectados');
  process.exit(1);
}
console.log('IMPORTAÇÃO CONCLUÍDA COM VALIDAÇÃO OK');
