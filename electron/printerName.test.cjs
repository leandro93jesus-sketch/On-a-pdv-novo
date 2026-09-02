const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pickExactPrinterName, PRINTER_NOT_FOUND_MESSAGE } = require('./printerName.cjs');

const printers = [
  { name: 'Microsoft Print to PDF', displayName: 'Microsoft Print to PDF', isDefault: false },
  { name: 'POS-80C', displayName: 'Impressora Térmica POS-80C', isDefault: true },
];

test('recusa nome antigo / apelido e não devolve o valor salvo', () => {
  const res = pickExactPrinterName(printers, 'POS 80');
  assert.equal(res.ok, false);
  assert.equal(res.deviceName, undefined);
  assert.equal(res.error, PRINTER_NOT_FOUND_MESSAGE);
});

test('recusa displayName', () => {
  const res = pickExactPrinterName(printers, 'Impressora Térmica POS-80C');
  assert.equal(res.ok, false);
  assert.equal(res.deviceName, undefined);
});

test('aceita somente printer.name exato', () => {
  const res = pickExactPrinterName(printers, 'POS-80C');
  assert.equal(res.ok, true);
  assert.equal(res.deviceName, 'POS-80C');
});

test('sem nome configurado usa isDefault.name', () => {
  const res = pickExactPrinterName(printers, '');
  assert.equal(res.ok, true);
  assert.equal(res.deviceName, 'POS-80C');
});

test('lista vazia nunca inventa deviceName', () => {
  const res = pickExactPrinterName([], 'POS-80C');
  assert.equal(res.ok, false);
  assert.equal(res.deviceName, undefined);
});
