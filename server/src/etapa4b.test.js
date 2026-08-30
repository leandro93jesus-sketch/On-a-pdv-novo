import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  matchesOncasPdvV2,
  toOncasPdvV2Model,
} from './services/legacyImport/mapOncasPdvV2.js';
import { simulateOncasPdvV2Import } from './services/legacyImport/simulateOncasPdvV2.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_JSON =
  process.env.ONCAS_REAL_JSON ||
  '/home/ubuntu/.cursor/projects/workspace/uploads/oncas-pdv-backup-2026-08-07-1786145822438_eda5.json';

// O JSON legado é um insumo do cliente, não versionado. Sem ele a suíte não pode
// validar a importação real: pula em vez de reprovar em máquina limpa.
const hasRealJson = existsSync(REAL_JSON);
const skipReason = `JSON legado ausente (${REAL_JSON}); defina ONCAS_REAL_JSON para rodar`;

test('adaptador detecta Oncas PDV v2', { skip: hasRealJson ? false : skipReason }, () => {
  const data = JSON.parse(readFileSync(REAL_JSON, 'utf8'));
  assert.equal(matchesOncasPdvV2(data), true);
  const model = toOncasPdvV2Model(data);
  assert.equal(model.adapter, 'oncas_pdv_v2');
  assert.equal(model.products.length, 488);
  assert.equal(model.customers.length, 7);
  assert.equal(model.sales.length, 87);
});

test('simulação em DB temporário fica consistente (não toca DB principal)', { skip: hasRealJson ? false : skipReason }, () => {
  const report = simulateOncasPdvV2Import(REAL_JSON, { cleanup: true });
  assert.equal(report.mode, 'SIMULATION_ONLY');
  assert.equal(report.validation.ok, true);
  assert.equal(report.finance.sales_total_match, true);
  assert.equal(report.stock.stock_sum_match, true);
  assert.equal(report.after_db.products, 488);
  assert.equal(report.after_db.sales, 87);
  assert.equal(report.errors.length, 0);
  // Crediário vazio no backup real
  assert.equal(report.after_db.credit_accounts, 0);
});

test('pagamentos cartão crédito/débito mapeiam para cartao (não crediário)', { skip: hasRealJson ? false : skipReason }, () => {
  const data = JSON.parse(readFileSync(REAL_JSON, 'utf8'));
  const model = toOncasPdvV2Model(data);
  const methods = new Set(model.sales.map((s) => s.payment_method));
  assert.ok(methods.has('cartao'));
  assert.ok(methods.has('pix'));
  assert.ok(methods.has('dinheiro'));
  assert.equal(methods.has('crediario'), false);
});
