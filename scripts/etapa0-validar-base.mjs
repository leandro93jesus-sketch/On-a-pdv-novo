#!/usr/bin/env node
/**
 * ETAPA 0 — Validação da base funcional ANTES de qualquer alteração.
 *
 * Sobe a API real sobre um banco ISOLADO (nunca o banco de produção), executa
 * integrity_check, faz uma venda completa e confere sales / sale_items /
 * sale_payments / stock_movements, além de abrir as telas de histórico,
 * produtos-estoque, caixa e relatórios via API.
 *
 * Uso: node scripts/etapa0-validar-base.mjs
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'onca-etapa0-'));
process.env.PDV_DATA_DIR = tmp;
process.env.PDV_DB_PATH = join(tmp, 'etapa0.db');
process.env.NODE_ENV = 'test';

const { openDatabase, setDb, getDb, closeDb } = await import('../server/src/db/index.js');
const { runMigrations } = await import('../server/src/db/migrate.js');
const { ensureBootstrapAdmin } = await import('../server/src/services/authService.js');
const { createApp } = await import('../server/src/app.js');

const rows = [];
let failures = 0;

function step(n, name, ok, detail) {
  if (!ok) failures += 1;
  rows.push({ n, name, result: ok ? 'PASS' : 'FAIL', detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${String(n).padStart(2, '0')}. ${name} — ${detail}`);
}

const db = openDatabase(process.env.PDV_DB_PATH);
setDb(db);
runMigrations(db);
ensureBootstrapAdmin();
const app = createApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

let token = null;
async function api(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

// 1-3. API sobe e responde
const health = await api('GET', '/api/health');
step(1, 'API inicia e responde /api/health', health.status === 200, `status=${health.status} versao=${health.json.version}`);

// 4. conexão SQLite
const dbFile = db.pragma('database_list')[0]?.file ?? '';
step(4, 'Conexao SQLite ativa', dbFile.includes('etapa0.db'), `arquivo=${dbFile}`);

// 5. integrity_check
const integrityBefore = db.pragma('integrity_check')[0].integrity_check;
step(5, 'PRAGMA integrity_check (antes)', integrityBefore === 'ok', `resultado=${integrityBefore}`);

// login para as telas autenticadas
const login = await api('POST', '/api/auth/login', { login: 'admin', password: 'admin123' });
token = login.json.token;
step(2, 'Autenticacao do operador', login.status === 200 && !!token, `status=${login.status}`);

// caixa aberto (pré-requisito de venda)
const openCash = await api('POST', '/api/cash/sessions/open', {
  operator_name: 'Etapa0',
  opening_amount_cents: 20000,
});
step(16, 'Tela Caixa: abertura de sessao', openCash.status < 300, `status=${openCash.status}`);

// 6-7. tela de vendas carrega produtos
const barcode = `789${String(Date.now()).slice(-10)}`;
const prod = await api('POST', '/api/products', {
  name: 'Etapa0 Detergente 500ml',
  barcode,
  sku: `E0-${Date.now()}`,
  price_cents: 2500,
  cost_cents: 1200,
  stock_qty: 10,
  min_stock_qty: 1,
});
step(7, 'Cadastro/carga de produtos', prod.status === 201, `status=${prod.status} id=${prod.json.id}`);

const list = await api('GET', '/api/products?limit=5');
const listArr = Array.isArray(list.json) ? list.json : list.json.items;
step(6, 'Tela Vendas: lista de produtos carrega', list.status === 200 && (listArr?.length ?? 0) > 0, `itens=${listArr?.length}`);

// 8. adicionar ao carrinho = bipagem por código exato
const scan = await api('GET', `/api/products?barcode=${barcode}`);
step(8, 'Adicionar produto ao carrinho (bipagem exata)', scan.status === 200 && scan.json.length === 1, `hits=${scan.json.length}`);

// 9-13. finalizar venda e conferir tabelas
const sale = await api('POST', '/api/sales', {
  payment_method: 'dinheiro',
  amount_received_cents: 10000,
  items: [{ product_id: prod.json.id, quantity: 2 }],
});
step(9, 'Finalizar venda de teste', sale.status === 201, `status=${sale.status} total=${sale.json.total_cents} troco=${sale.json.change_cents}`);

const saleId = sale.json.id;
const saleRow = db.prepare('SELECT id, total_cents, status FROM sales WHERE id = ?').get(saleId);
step(10, 'Registro em sales', !!saleRow && saleRow.total_cents === 5000, JSON.stringify(saleRow));

const itemRows = db.prepare('SELECT product_id, quantity, line_total_cents FROM sale_items WHERE sale_id = ?').all(saleId);
step(11, 'Registro em sale_items', itemRows.length === 1 && itemRows[0].quantity === 2, JSON.stringify(itemRows));

const payRows = db.prepare('SELECT method, amount_cents FROM sale_payments WHERE sale_id = ?').all(saleId);
step(12, 'Registro em sale_payments', payRows.length >= 1 && payRows.reduce((a, p) => a + p.amount_cents, 0) === 5000, JSON.stringify(payRows));

const moveRows = db
  .prepare(
    `SELECT movement_type, quantity_delta, stock_before, stock_after
     FROM stock_movements WHERE reference_type = 'sale' AND reference_id = ?`
  )
  .all(saleId);
step(
  13,
  'Registro em stock_movements',
  moveRows.length === 1 && moveRows[0].stock_after === 8 && moveRows[0].quantity_delta === -2,
  JSON.stringify(moveRows)
);

// 14. histórico
const history = await api('GET', '/api/sales?limit=10');
const historyArr = Array.isArray(history.json) ? history.json : history.json.items;
const detail = await api('GET', `/api/sales/${saleId}`);
step(14, 'Tela Historico abre com a venda e detalhe', history.status === 200 && historyArr.some((s) => s.id === saleId) && detail.status === 200, `itens=${historyArr.length} detalhe=${detail.status}`);

// 15. produtos/estoque
const stockList = await api('GET', `/api/stock/movements?product_id=${prod.json.id}`);
const stockArr = Array.isArray(stockList.json) ? stockList.json : stockList.json.items;
step(15, 'Tela Produtos/Estoque abre com movimentacoes', stockList.status === 200 && (stockArr?.length ?? 0) >= 1, `movimentacoes=${stockArr?.length}`);

const cashNow = await api('GET', '/api/cash/sessions/current');
step(17, 'Caixa registra a venda em dinheiro', Number(cashNow.json?.sales_dinheiro_cents ?? 0) === 5000, `dinheiro=${cashNow.json?.sales_dinheiro_cents}`);

// relatórios
const reportCatalog = await api('GET', '/api/reports');
const reportPeriodo = await api('GET', '/api/reports/vendas_periodo');
const reportDetalhado = await api('GET', '/api/reports/vendas_detalhadas?period=hoje');
step(
  18,
  'Tela Relatorios abre (catalogo + vendas por periodo + vendas detalhadas)',
  reportCatalog.status === 200 &&
    reportPeriodo.status === 200 &&
    reportDetalhado.status === 200 &&
    reportDetalhado.json.rows.some((r) => r.id === saleId),
  `catalogo=${reportCatalog.json.length} periodo=${reportPeriodo.json.rows.length} detalhado=${reportDetalhado.json.rows.length}`
);

// backup
const backup = await api('POST', '/api/backups');
step(19, 'Backup/checkpoint da versao funcional', backup.status < 300, `status=${backup.status} arquivo=${backup.json?.file ?? backup.json?.filename ?? '-'}`);

// impressão / Firebase (configuráveis)
const settings = await api('GET', '/api/settings');
const printerCfg = JSON.stringify(settings.json?.printers ?? settings.json?.printer ?? {}).slice(0, 80);
step(20, 'Configuracoes de impressao presentes', settings.status === 200, `settings=${settings.status} impressoras=${printerCfg}`);

// integrity depois de tudo
const integrityAfter = db.pragma('integrity_check')[0].integrity_check;
step(21, 'PRAGMA integrity_check (depois)', integrityAfter === 'ok', `resultado=${integrityAfter}`);

server.close();
closeDb();
rmSync(tmp, { recursive: true, force: true });

const summary = {
  etapa: 'ETAPA 0 — base funcional',
  versao: JSON.parse(await (await import('node:fs')).promises.readFile('package.json', 'utf8')).version,
  total: rows.length,
  aprovados: rows.filter((r) => r.result === 'PASS').length,
  reprovados: failures,
  itens: rows,
};
writeFileSync('release/etapa0-base-funcional.json', `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

console.log(`\n${failures === 0 ? 'ETAPA 0 APROVADA' : 'ETAPA 0 REPROVADA'} — ${summary.aprovados}/${summary.total} itens`);
process.exit(failures === 0 ? 0 : 1);
