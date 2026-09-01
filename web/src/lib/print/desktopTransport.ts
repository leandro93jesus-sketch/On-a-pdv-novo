import type { PrintTransport, PrintTransportJob } from './printReceipt.ts';
import { EMPTY_CUPOM_MESSAGE, validateCupomText } from './cupomValidate.ts';

/** Transporte real: só envia se o cupom passou na trava. */
export function createDesktopTransport(): PrintTransport {
  return {
    kind: 'desktop',
    async send(job: PrintTransportJob) {
      const check = validateCupomText(job.text);
      if (!check.ok) {
        return { ok: false, error: check.error, sent: false };
      }
      if (!window.oncaDesktop?.printCupom) {
        return {
          ok: false,
          error:
            'Impressão direta disponível no aplicativo desktop. Abra o ONÇA PDV instalado para enviar à térmica.',
          sent: false,
        };
      }
      const res = await window.oncaDesktop.printCupom({
        text: job.text,
        html: job.html,
        bytes: Array.from(job.bytes),
        method: job.method,
        deviceName: job.printerName,
        width: job.width,
        host: job.host,
        port: job.port,
      });
      return { ok: Boolean(res.ok), error: res.error, via: res.via || 'desktop', sent: Boolean(res.ok) };
    },
  };
}

export function createBrowserPreviewOnlyTransport(): PrintTransport {
  return {
    kind: 'browser-preview',
    async send() {
      return {
        ok: false,
        error: `${EMPTY_CUPOM_MESSAGE}\n(No navegador o cupom só é pré-visualizado; use o aplicativo desktop para a térmica.)`,
        sent: false,
      };
    },
  };
}
