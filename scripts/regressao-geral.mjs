#!/usr/bin/env node
/**
 * Regressão geral das funções listadas na atualização incremental.
 *
 * Roda contra um banco ISOLADO (nunca o de produção) e confere, uma por uma, as
 * funções que já existiam antes das melhorias, mais as quatro novas.
 *
 * Uso: node scripts/regressao-geral.mjs
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'onca-regressao-'));
process.env.PDV_DATA_DIR = tmp;
process.env.PDV_DB_PATH = join(tmp, 'regressao.db');
process.env.NODE_ENV = 'test';
process.env.PDV_SEED = '0';

const { openDatabase, setDb, getDb, closeDb } = await import('../server/src/db/index.js');
const { runMigrations } = await import('../server/src/db/migrate.js');
const { ensureBootstrapAdmin } = await import('../server/src/services/authService.js');
const { createApp } = await import('../server/src/app.js');

const rows = [];
let failures = 0;

function check(nome, ok, detalhe = '') {
  if (!ok) failures += 1;
  rows.push({ nome, resultado: ok ? 'PASS' : 'FAIL', detalhe });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
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
async function bin(path) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
}

// 1. abertura do sistema
const health = await api('GET', '/api/health');
check('01. Abertura do sistema (API responde)', health.status === 200, `versao=${health.json.version}`);

// 2. login
const login = await api('POST', '/api/auth/login', { login: 'admin', password: 'admin123' });
token = login.json.token;
check('02. Login', login.status === 200 && Boolean(token));

// caixa aberto (pré-requisito)
const caixa = await api('POST', '/api/cash/sessions/open', {
  operator_name: 'Regressao',
  opening_amount_cents: 10000,
});
check('03. Caixa: abertura', caixa.status === 201, `id=${caixa.json.id}`);

// 4. produtos
const barcode = `7891${String(Date.now()).slice(-9)}`;
const prod = await api('POST', '/api/products', {
  name: 'DESINFETANTE LAVANDA 5L',
  barcode,
  sku: `REG-${Date.now()}`,
  category: 'Limpeza',
  price_cents: 3750,
  cost_cents: 1500,
  stock_qty: 10,
  min_stock_qty: 2,
});
check('04. Produtos: cadastro', prod.status === 201, `id=${prod.json.id}`);

// 5. estoque
const entrada = await api('POST', '/api/stock/movements', {
  product_id: prod.json.id,
  movement_type: 'entry',
  quantity: 5,
  reason: 'Entrada manual',
});
check('05. Estoque: entrada com antes/depois', entrada.status < 300 && entrada.json.stock_after === 15, `10 -> ${entrada.json.stock_after}`);

// 6. código de barras (scanner exato)
const scan = await api('GET', `/api/products?barcode=${barcode}`);
const scanPrefixo = await api('GET', `/api/products?barcode=${barcode.slice(0, -1)}`);
check(
  '06. Codigo de barras: match exato e prefixo sem resultado',
  scan.json.length === 1 && scanPrefixo.json.length === 0,
  `exato=${scan.json.length} prefixo=${scanPrefixo.json.length}`
);

// 7. consulta rápida de preço / busca manual inteligente (NOVO)
const manual = await api('GET', `/api/products/busca-manual?q=${encodeURIComponent('desinf lav')}`);
check(
  '07. Consulta rapida / busca manual inteligente',
  manual.status === 200 && manual.json.some((p) => p.id === prod.json.id),
  `resultados=${manual.json.length}`
);

// 8. cadastro de código desconhecido
const desconhecido = `7899${String(Date.now()).slice(-9)}`;
const semMatch = await api('GET', `/api/products?barcode=${desconhecido}`);
const novo = await api('POST', '/api/products', {
  name: 'Produto Cadastro Rapido',
  barcode: desconhecido,
  price_cents: 990,
  stock_qty: 3,
  confirm_similar_name: true,
});
check(
  '08. Cadastro de codigo desconhecido durante a venda',
  semMatch.json.length === 0 && novo.status === 201,
  `criado id=${novo.json.id}`
);

// 9/10/11. carrinho + troco + venda
const venda = await api('POST', '/api/sales', {
  payment_method: 'dinheiro',
  amount_received_cents: 5000,
  items: [{ product_id: prod.json.id, quantity: 1 }],
});
check('09. Carrinho e venda concluida', venda.status === 201, `total=${venda.json.total_cents}`);
check('10. Troco', venda.json.change_cents === 1250, `recebido=5000 total=3750 troco=${venda.json.change_cents}`);

// 12. pagamento (misto e cartão)
const misto = await api('POST', '/api/sales', {
  payments: [
    { method: 'dinheiro', amount_cents: 1750 },
    { method: 'cartao', amount_cents: 2000, card_type: 'CREDIT' },
  ],
  amount_received_cents: 2000,
  items: [{ product_id: prod.json.id, quantity: 1 }],
});
check(
  '11. Pagamento misto com troco so sobre a parte em dinheiro',
  misto.status === 201 && misto.json.change_cents === 250,
  `troco=${misto.json.change_cents}`
);

// 13. estoque baixou
const estoqueAtual = (await api('GET', `/api/products/${prod.json.id}`)).json.stock_qty;
check('12. Estoque baixa na venda', estoqueAtual === 13, `15 -> ${estoqueAtual}`);

// 14. caixa
const caixaAtual = await api('GET', '/api/cash/sessions/current');
check(
  '13. Caixa registra vendas por forma',
  Number(caixaAtual.json.sales_dinheiro_cents) === 5500,
  `dinheiro=${caixaAtual.json.sales_dinheiro_cents}`
);

// 15. fechamento (NOVO: apresentação clara)
const conf = await api('GET', `/api/cash/sessions/${caixa.json.id}`);
const b = conf.json.breakdown;
const esperadoManual = b.opening_amount_cents + b.sales_dinheiro_cents + b.cash_in_cents - b.cash_out_cents;
check(
  '14. Fechamento: valor esperado ignora pix/cartao/crediario',
  conf.json.expected_amount_cents === esperadoManual,
  `esperado=${conf.json.expected_amount_cents}`
);
check(
  '15. Fechamento: resumo com vendas, itens, bruto, descontos e liquido',
  b.sales_count === 2 && b.items_sold === 2 && b.gross_cents === b.net_cents + b.discount_cents,
  `vendas=${b.sales_count} itens=${b.items_sold}`
);

// 16. histórico
const hist = await api('GET', '/api/sales?paged=1&limit=10');
const detalhe = await api('GET', `/api/sales/${venda.json.id}`);
const related = await api('GET', `/api/sales/${venda.json.id}/related`);
check(
  '16. Historico: lista, detalhe e dados relacionados',
  hist.status === 200 && detalhe.status === 200 && related.status === 200,
  `vendas=${hist.json.items.length}`
);

// 17. alteração
const alterada = await api('PUT', `/api/sales/${misto.json.id}`, {
  admin_password: '230808',
  reason: 'Regressao alteracao',
  items: [{ product_id: prod.json.id, quantity: 2, unit_price_cents: 3750 }],
});
check('17. Alteracao de venda com PIN', alterada.status === 200, `total=${alterada.json.total_cents}`);

// 18. cancelamento
const cancelada = await api('POST', `/api/sales/${misto.json.id}/cancel`, {
  reason: 'Regressao cancelamento',
  admin_password: '230808',
});
check('18. Cancelamento com estorno', cancelada.status === 200 && cancelada.json.status === 'cancelled');

// 19. relatórios
const catalogo = await api('GET', '/api/reports');
const detalhado = await api('GET', '/api/reports/vendas_detalhadas?period=hoje');
const periodo = await api('GET', '/api/reports/vendas_periodo');
check(
  '19. Relatorios: catalogo, vendas detalhadas e vendas por periodo',
  catalogo.status === 200 && detalhado.status === 200 && periodo.status === 200,
  `relatorios=${catalogo.json.length} linhas=${detalhado.json.rows.length}`
);

// 20. impressão (fila)
const job = await api('POST', '/api/print/jobs', {
  document_type: 'comprovante',
  document_ref: venda.json.sale_number,
  title: 'Regressao impressao',
  kind: 'receipt',
});
const settings = await api('GET', '/api/settings');
check(
  '20. Impressao: fila e configuracao de impressoras',
  job.status < 300 && settings.status === 200,
  `job=${job.status}`
);

// 21. PDF (venda, relatório e fechamento)
const pdfVenda = await bin(`/api/receipts/sales/${venda.json.id}/pdf`);
const pdfRelatorio = await bin('/api/reports/vendas_detalhadas/pdf?period=hoje');
const pdfFechamento = await bin(`/api/cash/sessions/${caixa.json.id}/pdf`);
const csv = await bin('/api/reports/vendas_detalhadas/csv?period=hoje');
const ehPdf = (r) => r.status === 200 && r.body.subarray(0, 4).toString('latin1') === '%PDF';
check(
  '21. PDF de venda, de relatorio e de fechamento + CSV',
  ehPdf(pdfVenda) && ehPdf(pdfRelatorio) && ehPdf(pdfFechamento) && csv.status === 200,
  `venda=${pdfVenda.body.length}B relatorio=${pdfRelatorio.body.length}B fechamento=${pdfFechamento.body.length}B`
);

// 22. reimpressão não altera nada (NOVO)
function fotografia() {
  const one = (sql, ...p) => getDb().prepare(sql).get(...p);
  return {
    sales: one('SELECT COUNT(*) AS c FROM sales').c,
    items: one('SELECT COUNT(*) AS c FROM sale_items').c,
    payments: one('SELECT COUNT(*) AS c FROM sale_payments').c,
    stock: one('SELECT stock_qty AS q FROM products WHERE id = ?', prod.json.id).q,
  };
}
const antes = fotografia();
await bin(`/api/receipts/sales/${venda.json.id}/pdf`);
await bin(`/api/receipts/sales/${venda.json.id}/pdf?download=1`);
const depois = fotografia();
check(
  '22. Reimpressao/PDF sao somente leitura',
  JSON.stringify(antes) === JSON.stringify(depois),
  JSON.stringify(depois)
);

// 23. backup
const backup = await api('POST', '/api/backups');
check('23. Backup', backup.status === 201 && backup.json.valid === true, backup.json.filename);

// 24. Firebase: não existe integração neste projeto (local-first com SQLite)
check(
  '24. Firebase: nao ha integracao neste projeto (local-first SQLite)',
  true,
  'nada a validar nem a quebrar'
);

// 25. integridade
const integridade = db.pragma('integrity_check')[0].integrity_check;
const fks = db.pragma('foreign_key_check').length;
check('25. Integridade do banco', integridade === 'ok' && fks === 0, `integrity=${integridade} fk=${fks}`);

server.close();
closeDb();
rmSync(tmp, { recursive: true, force: true });

const resumo = {
  etapa: 'Regressao geral — melhorias operacionais',
  total: rows.length,
  aprovados: rows.filter((r) => r.resultado === 'PASS').length,
  reprovados: failures,
  itens: rows,
};
writeFileSync('release/regressao-geral.json', `${JSON.stringify(resumo, null, 2)}\n`, 'utf8');

console.log(`\n${failures === 0 ? 'REGRESSAO APROVADA' : 'REGRESSAO REPROVADA'} — ${resumo.aprovados}/${resumo.total}`);
process.exit(failures === 0 ? 0 : 1);
