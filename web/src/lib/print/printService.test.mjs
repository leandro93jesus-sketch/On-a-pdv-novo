import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockPrintService, PRINT_SERVICE_NAME } from './printService.ts';
import { PRINTER_NOT_FOUND_MESSAGE, resolveConfiguredPrinter } from './printerResolve.ts';
import { resetPhysicalTestGuard } from './printReceipt.ts';

const printers = [
  { name: 'Microsoft Print to PDF', displayName: 'Microsoft Print to PDF', isDefault: false },
  { name: 'POS-80C', displayName: 'Impressora Térmica POS-80C', isDefault: true },
];

function sampleSale(over = {}) {
  return {
    sale_number: '000777',
    created_at: '01/09/2026 23:00',
    items: [{ name: 'Desinfetante', quantity: 1, unit_price_cents: 1500, line_total_cents: 1500 }],
    payments: [{ method: 'pix', amount_cents: 1500 }],
    subtotal_cents: 1500,
    discount_cents: 0,
    total_cents: 1500,
    ...over,
  };
}

test('venda, reimpressão e teste chamam o mesmo PrintService.print', async () => {
  resetPhysicalTestGuard();
  const { service, mock } = createMockPrintService({
    printers,
    settings: { use_windows_default: true, method: 'escpos' },
  });
  const sale = await service.printSale(sampleSale());
  const reprint = await service.printSale(sampleSale(), { reprint: true });
  const engine = await service.printEngineTest();
  assert.equal(sale.service, PRINT_SERVICE_NAME);
  assert.equal(reprint.service, PRINT_SERVICE_NAME);
  assert.equal(engine.service, PRINT_SERVICE_NAME);
  assert.equal(sale.kind, 'sale');
  assert.equal(reprint.kind, 'reprint');
  assert.equal(engine.kind, 'engine-test');
  assert.equal(mock.jobs.length, 3);
  assert.equal(sale.deviceName, 'POS-80C');
  assert.equal(reprint.deviceName, 'POS-80C');
  assert.equal(engine.deviceName, 'POS-80C');
});

test('mock da venda mostra o cupom exato que seria enviado', async () => {
  resetPhysicalTestGuard();
  const { service, mock } = createMockPrintService({ printers });
  const res = await service.printSale(sampleSale());
  assert.equal(res.ok, true);
  assert.equal(res.sent, false);
  assert.match(res.cupomText, /Desinfetante/);
  assert.match(res.cupomText, /000777/);
  assert.equal(mock.jobs[0].text, res.cupomText);
  assert.ok(res.logs.some((l) => l.step === '[1] Venda carregada'));
  assert.ok(res.logs.some((l) => l.step === '[2] Cupom gerado'));
  assert.ok(res.logs.some((l) => l.step === '[3] Conteúdo validado'));
  assert.ok(res.logs.some((l) => l.step === '[4] Impressora selecionada'));
  assert.ok(res.logs.some((l) => l.step === '[5] Pedido de impressão enviado'));
  assert.ok(res.logs.some((l) => l.step === '[6] Retorno da impressão'));
});

test('reimpressão marca REIMPRESSÃO no mesmo motor', async () => {
  resetPhysicalTestGuard();
  const { service, mock } = createMockPrintService({ printers });
  const res = await service.printSale(sampleSale(), { reprint: true });
  assert.match(res.cupomText, /REIMPRESSÃO/);
  assert.equal(mock.jobs[0].text, res.cupomText);
});

test('teste pelo motor gera ONÇA / TESTE PDV / IMPRESSORA OK', async () => {
  resetPhysicalTestGuard();
  const { service, mock } = createMockPrintService({ printers });
  const res = await service.printEngineTest();
  assert.match(res.cupomText, /ONÇA/);
  assert.match(res.cupomText, /TESTE PDV/);
  assert.match(res.cupomText, /IMPRESSORA OK/);
  assert.equal(mock.jobs[0].text, res.cupomText);
});

test('displayName NÃO vira deviceName', () => {
  const resolved = resolveConfiguredPrinter(
    { use_windows_default: false, receipt_printer: 'Impressora Térmica POS-80C' },
    printers
  );
  assert.equal(resolved.ok, false);
  assert.equal(resolved.deviceName, undefined);
  assert.equal(resolved.error, PRINTER_NOT_FOUND_MESSAGE);
});

test('nome salvo inválido NÃO é enviado à impressão', async () => {
  resetPhysicalTestGuard();
  const { service, mock } = createMockPrintService({
    printers,
    settings: { use_windows_default: false, receipt_printer: 'POS 80' },
  });
  const res = await service.printSale(sampleSale());
  assert.equal(res.ok, false);
  assert.equal(res.error, PRINTER_NOT_FOUND_MESSAGE);
  assert.equal(res.deviceName, undefined);
  assert.equal(mock.jobs.length, 0);
});

test('printer.name exato é o deviceName enviado', async () => {
  resetPhysicalTestGuard();
  const { service, mock } = createMockPrintService({
    printers,
    settings: { use_windows_default: false, receipt_printer: 'POS-80C' },
  });
  const res = await service.printSale(sampleSale());
  assert.equal(res.ok, true);
  assert.equal(res.deviceName, 'POS-80C');
  assert.equal(mock.jobs[0].printerName, 'POS-80C');
});

test('use_windows_default ignora nome lembrado/salvo e usa isDefault', () => {
  const resolved = resolveConfiguredPrinter(
    { use_windows_default: true, receipt_printer: 'Microsoft Print to PDF' },
    printers
  );
  assert.equal(resolved.deviceName, 'POS-80C');
  assert.equal(resolved.source, 'windows-default');
});

test('A4 da venda não vai para a térmica — PrintService força 80mm', async () => {
  resetPhysicalTestGuard();
  const { service, mock } = createMockPrintService({
    printers,
    settings: { profile: { format: 'A4', copies: 1, auto_print: false, mode: 'manual' } },
  });
  const res = await service.printSale(sampleSale(), { paperFormat: 'A4' });
  assert.equal(res.ok, true);
  assert.equal(mock.jobs[0].width, '80mm');
});

test('venda sem itens ainda gera cupom validável e o mock mostra (sem itens)', async () => {
  resetPhysicalTestGuard();
  const { service, mock } = createMockPrintService({ printers });
  const res = await service.printSale(sampleSale({ items: [] }));
  assert.equal(res.ok, true);
  assert.match(res.cupomText, /\(sem itens\)/);
  assert.equal(mock.jobs[0].text, res.cupomText);
});
