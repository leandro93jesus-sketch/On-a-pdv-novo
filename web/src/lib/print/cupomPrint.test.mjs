import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPhysicalTestCupom,
  buildSaleCupom,
  charsForWidth,
  formatMoney,
  linePair,
  paymentLabel,
  wrapLine,
} from './cupomBuilder.ts';
import { EMPTY_CUPOM_MESSAGE, validateCupomText, assertCupomReady } from './cupomValidate.ts';
import { encodeEscPos, inspectEscPos } from './escposEncoder.ts';
import { createMockPrinter } from './mockPrinter.ts';
import {
  dispatchCupom,
  prepareCupomJob,
  previewPhysicalTestCupom,
  previewSaleCupom,
  resetPhysicalTestGuard,
} from './printReceipt.ts';

function sampleSale(over = {}) {
  return {
    sale_number: '000123',
    created_at: '01/09/2026 20:30',
    items: [
      { name: 'Produto A', quantity: 1, unit_price_cents: 1000, line_total_cents: 1000 },
      { name: 'Produto B', quantity: 2, unit_price_cents: 1000, line_total_cents: 2000 },
    ],
    payments: [{ method: 'pix', amount_cents: 3000 }],
    subtotal_cents: 3000,
    discount_cents: 0,
    total_cents: 3000,
    ...over,
  };
}

test('cupom de venda contém empresa, itens, total e pagamento', () => {
  const cupom = buildSaleCupom(sampleSale(), { company: 'ONÇA PRODUTOS DE LIMPEZA', width: '80mm' });
  assert.match(cupom.text, /ONÇA PRODUTOS DE LIMPEZA/);
  assert.match(cupom.text, /Venda: 000123/);
  assert.match(cupom.text, /1x Produto A/);
  assert.match(cupom.text, /2x Produto B/);
  assert.match(cupom.text, /TOTAL/);
  assert.match(cupom.text, /R\$\s*30,00/);
  assert.match(cupom.text, /PIX/);
  assert.equal(cupom.hasItems, true);
  assert.equal(cupom.hasTotal, true);
  assert.equal(cupom.hasPayment, true);
});

test('largura 58 mm quebra linhas longas', () => {
  const wide = 'Desinfetante lavanda concentrado 5 litros';
  const cupom = buildSaleCupom(
    sampleSale({
      items: [{ name: wide, quantity: 1, unit_price_cents: 1990, line_total_cents: 1990 }],
    }),
    { width: '58mm' }
  );
  const w = charsForWidth('58mm');
  for (const line of cupom.text.split('\n')) {
    assert.ok(line.length <= w + 1, `linha maior que ${w}: ${JSON.stringify(line)}`);
  }
});

test('dinheiro e troco aparecem no cupom', () => {
  const cupom = buildSaleCupom(
    sampleSale({
      payments: [{ method: 'dinheiro', amount_cents: 5000 }],
      amount_received_cents: 5000,
      change_cents: 2000,
      total_cents: 3000,
    })
  );
  assert.match(cupom.text, /Dinheiro/);
  assert.match(cupom.text, /Troco/);
  assert.match(cupom.text, /R\$\s*20,00/);
});

test('cartão crédito e débito', () => {
  assert.equal(paymentLabel('cartao', 'CREDIT'), 'Cartão Crédito');
  assert.equal(paymentLabel('cartao', 'DEBIT'), 'Cartão Débito');
  const cupom = buildSaleCupom(
    sampleSale({ payments: [{ method: 'cartao', card_type: 'DEBIT', amount_cents: 3000 }] })
  );
  assert.match(cupom.text, /Cartão Débito/);
});

test('reimpressão marca o cupom sem mudar totais', () => {
  const normal = buildSaleCupom(sampleSale());
  const reprint = buildSaleCupom(sampleSale(), { reprint: true });
  assert.match(reprint.text, /REIMPRESSÃO/);
  assert.match(reprint.text, /R\$\s*30,00/);
  assert.ok(!normal.text.includes('REIMPRESSÃO'));
});

test('trava: cupom vazio ou só traços não imprime', () => {
  assert.equal(validateCupomText('').ok, false);
  assert.equal(validateCupomText('   ').ok, false);
  assert.equal(validateCupomText('----------\n----').ok, false);
  assert.equal(validateCupomText(null).ok, false);
  assert.throws(() => assertCupomReady(''), (e) => e.message.includes('IMPRESSÃO CANCELADA'));
});

test('trava: job vazio não chega no mock', async () => {
  const mock = createMockPrinter();
  const result = await dispatchCupom(
    {
      text: '',
      bytes: new Uint8Array(),
      width: '80mm',
      method: 'escpos',
      cut: true,
    },
    mock
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, EMPTY_CUPOM_MESSAGE);
  assert.equal(mock.jobs.length, 0);
});

test('ESC/POS contém init, texto e corte', () => {
  const cupom = buildSaleCupom(sampleSale());
  const bytes = encodeEscPos(cupom.text, { cut: true });
  const info = inspectEscPos(bytes);
  assert.equal(info.hasInit, true);
  assert.equal(info.hasCut, true);
  assert.equal(info.hasText, true);
  assert.ok(info.totalBytes > 40);
});

test('mock registra venda com 1 produto sem enviar ao hardware', async () => {
  const mock = createMockPrinter();
  const cupom = buildSaleCupom(
    sampleSale({
      items: [{ name: 'Sabão', quantity: 1, unit_price_cents: 850, line_total_cents: 850 }],
      payments: [{ method: 'pix', amount_cents: 850 }],
      total_cents: 850,
    })
  );
  const job = prepareCupomJob(cupom, { method: 'escpos', cut: true });
  const res = await dispatchCupom(job, mock);
  assert.equal(res.ok, true);
  assert.equal(res.via, 'mock');
  assert.equal(res.sent, false);
  assert.equal(mock.jobs.length, 1);
  assert.match(mock.jobs[0].text, /1x Sabão/);
  assert.equal(mock.jobs[0].cut, true);
});

test('mock: vários produtos, 58 mm e 80 mm', async () => {
  const mock = createMockPrinter();
  for (const width of ['58mm', '80mm']) {
    const cupom = buildSaleCupom(sampleSale(), { width });
    await dispatchCupom(prepareCupomJob(cupom, { method: 'escpos' }), mock);
  }
  assert.equal(mock.jobs.length, 2);
  assert.equal(mock.jobs[0].width, '58mm');
  assert.equal(mock.jobs[1].width, '80mm');
});

test('preview virtual não envia bytes', () => {
  const preview = previewSaleCupom(sampleSale());
  assert.equal(preview.ok, true);
  assert.match(preview.html, /cupom-preview/);
  assert.match(preview.html, /background:\s*#ffffff/);
  assert.match(preview.html, /color:\s*#000000/);
});

test('cupom mínimo do teste físico tem o texto pedido', () => {
  const cupom = buildPhysicalTestCupom('80mm');
  assert.match(cupom.text, /ONÇA/);
  assert.match(cupom.text, /TESTE DE IMPRESSÃO/);
  assert.match(cupom.text, /IMPRESSORA OK/);
  assert.ok(!cupom.text.includes('Produto'));
  assert.equal(validateCupomText(cupom.text).ok, true);
});

test('teste físico só pode ser despachado uma vez por sessão', async () => {
  resetPhysicalTestGuard();
  const mock = createMockPrinter();
  const cupom = buildPhysicalTestCupom();
  const job = prepareCupomJob(cupom, { physicalTest: true, method: 'escpos' });
  const first = await dispatchCupom(job, mock);
  const second = await dispatchCupom(job, mock);
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.match(second.error, /já foi enviado/);
  assert.equal(mock.jobs.length, 1);
  resetPhysicalTestGuard();
});

test('formatMoney e linePair', () => {
  assert.equal(formatMoney(1000).replace(/\s/g, ' ').includes('10,00'), true);
  const line = linePair('TOTAL', 'R$ 30,00', 32);
  assert.ok(line.startsWith('TOTAL'));
  assert.ok(line.endsWith('R$ 30,00'));
  assert.ok(wrapLine('uma frase bem longa para quebrar', 10).length > 1);
});

test('preview do teste físico', () => {
  const p = previewPhysicalTestCupom('58mm');
  assert.equal(p.ok, true);
  assert.match(p.html, /IMPRESSORA OK/);
});
