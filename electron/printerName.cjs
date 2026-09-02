/**
 * deviceName válido = printer.name EXATO do getPrintersAsync().
 * Nunca reenviar o nome salvo se ele não estiver na lista.
 */

const PRINTER_NOT_FOUND_MESSAGE =
  'A impressora configurada não foi encontrada. Selecione novamente a impressora.';

function logPrinters(printers) {
  console.log('Impressoras detectadas:');
  (printers || []).forEach((p) => {
    console.log({
      name: p.name,
      displayName: p.displayName,
      description: p.description,
      isDefault: p.isDefault,
    });
  });
}

function pickExactPrinterName(printers, requested) {
  const list = Array.isArray(printers) ? printers : [];
  logPrinters(list);
  const wanted = requested == null || requested === '' ? '' : String(requested);
  if (wanted) {
    const found = list.find((p) => p.name === wanted);
    if (!found) {
      console.log('Impressora salva:', wanted);
      console.log('Impressora escolhida: (não encontrada)');
      console.log('deviceName enviado: (nenhum — recusado)');
      return { ok: false, error: PRINTER_NOT_FOUND_MESSAGE, deviceName: undefined };
    }
    console.log('Impressora escolhida:', found.name);
    console.log('deviceName enviado:', found.name);
    return { ok: true, deviceName: found.name };
  }
  const def = list.find((p) => p.isDefault);
  if (!def) {
    console.log('Impressora escolhida: (sem padrão)');
    console.log('deviceName enviado: (nenhum — recusado)');
    return { ok: false, error: PRINTER_NOT_FOUND_MESSAGE, deviceName: undefined };
  }
  console.log('Impressora escolhida:', def.name);
  console.log('deviceName enviado:', def.name);
  return { ok: true, deviceName: def.name };
}

module.exports = { PRINTER_NOT_FOUND_MESSAGE, pickExactPrinterName, logPrinters };
