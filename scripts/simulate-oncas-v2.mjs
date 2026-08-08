#!/usr/bin/env node
/**
 * Simulação somente-leitura do backup Oncas PDV v2 em banco TEMPORÁRIO.
 * NÃO altera o SQLite principal.
 *
 * Uso:
 *   node scripts/simulate-oncas-v2.mjs /caminho/backup.json
 */
import { resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { simulateOncasPdvV2Import } from '../server/src/services/legacyImport/simulateOncasPdvV2.js';

const jsonPath = resolve(process.argv[2] || '');
if (!jsonPath || !existsSync(jsonPath)) {
  console.error('Uso: node scripts/simulate-oncas-v2.mjs <arquivo.json>');
  process.exit(1);
}

mkdirSync(resolve('docs/reports'), { recursive: true });
const reportPath = resolve('docs/reports/SIMULACAO-IMPORT-ONCAS-PDV-V2.json');
const report = simulateOncasPdvV2Import(jsonPath, { reportPath, cleanup: true });

console.log('=== SIMULAÇÃO ONCAS PDV V2 (banco temporário) ===');
console.log(`SHA-256: ${report.source.sha256}`);
console.log(`Validação: ${report.validation.ok ? 'OK' : 'FALHA'}`);
console.log(`Produtos: JSON ${report.before_json.products} → DB ${report.after_db.products}`);
console.log(`Clientes: JSON ${report.before_json.customers} → DB ${report.after_db.customers}`);
console.log(`Vendas:   JSON ${report.before_json.sales} → DB ${report.after_db.sales}`);
console.log(`Itens:    JSON ${report.before_json.sale_items} → DB ${report.after_db.sale_items}`);
console.log(`Total vendas: R$ ${report.finance.json_sales_total_brl} (match=${report.finance.sales_total_match})`);
console.log(`Estoque sum match=${report.stock.stock_sum_match}`);
console.log(`Relatório: ${reportPath}`);
if (!report.validation.ok) process.exit(1);
console.log('SIMULAÇÃO CONSISTENTE — NENHUMA IMPORTAÇÃO DEFINITIVA FOI EXECUTADA.');
