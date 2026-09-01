/**
 * Orquestra cupom → validação → preview ou envio.
 * Sem conteúdo válido, não chama transporte.
 */

import { buildPhysicalTestCupom, buildSaleCupom, type BuiltCupom, type CupomSaleInput, type CupomWidth } from './cupomBuilder.ts';
import { EMPTY_CUPOM_MESSAGE, assertCupomReady, validateCupomText } from './cupomValidate.ts';
import { encodeEscPos, inspectEscPos } from './escposEncoder.ts';
import { cupomToPreviewHtml } from './previewHtml.ts';
import type { MockPrinter } from './mockPrinter.ts';

export type PrintMethod = 'windows' | 'escpos' | 'tcp';

export interface PrintTransportJob {
  text: string;
  bytes: Uint8Array;
  width: CupomWidth;
  method: PrintMethod;
  cut: boolean;
  printerName?: string;
  host?: string;
  port?: number;
  html?: string;
  physicalTest?: boolean;
}

export interface PrintTransport {
  kind: string;
  send: (job: PrintTransportJob) => Promise<{ ok: boolean; error?: string; via?: string; sent?: boolean }>;
}

let physicalTestSentThisSession = false;

export function resetPhysicalTestGuard(): void {
  physicalTestSentThisSession = false;
}

export function prepareCupomJob(
  cupom: BuiltCupom,
  opts: {
    method?: PrintMethod;
    cut?: boolean;
    printerName?: string;
    host?: string;
    port?: number;
    physicalTest?: boolean;
  } = {}
): PrintTransportJob {
  const check = validateCupomText(cupom.text);
  if (!check.ok) {
    throw Object.assign(new Error(check.error), { name: 'EmptyCupomError' });
  }
  const method = opts.method || 'escpos';
  const cut = opts.cut !== false;
  const bytes = encodeEscPos(check.text, { cut, width: cupom.width });
  const inspect = inspectEscPos(bytes);
  if (!inspect.hasInit || !inspect.hasText) {
    throw Object.assign(new Error(EMPTY_CUPOM_MESSAGE), { name: 'EmptyCupomError' });
  }
  return {
    text: check.text,
    bytes,
    width: cupom.width,
    method,
    cut,
    printerName: opts.printerName,
    host: opts.host,
    port: opts.port,
    html: cupomToPreviewHtml(check.text, cupom.width),
    physicalTest: Boolean(opts.physicalTest),
  };
}

export async function dispatchCupom(
  job: PrintTransportJob,
  transport: PrintTransport | MockPrinter
): Promise<{ ok: boolean; error?: string; via?: string; sent?: boolean; preview?: string }> {
  const check = validateCupomText(job.text);
  if (!check.ok) {
    return { ok: false, error: check.error, sent: false };
  }
  if (job.physicalTest) {
    if (physicalTestSentThisSession) {
      return {
        ok: false,
        error: 'Teste físico já foi enviado nesta sessão. Não será repetido para não gastar papel.',
        sent: false,
      };
    }
    physicalTestSentThisSession = true;
  }
  return transport.send(job);
}

export function previewSaleCupom(
  sale: CupomSaleInput,
  opts: { company?: string; width?: CupomWidth; reprint?: boolean } = {}
): { ok: true; cupom: BuiltCupom; html: string } | { ok: false; error: string } {
  const cupom = buildSaleCupom(sale, opts);
  const check = validateCupomText(cupom.text);
  if (!check.ok) return { ok: false, error: check.error };
  return { ok: true, cupom, html: cupomToPreviewHtml(cupom.text, cupom.width) };
}

export function previewPhysicalTestCupom(width: CupomWidth = '80mm') {
  const cupom = buildPhysicalTestCupom(width);
  assertCupomReady(cupom.text);
  return { ok: true as const, cupom, html: cupomToPreviewHtml(cupom.text, width) };
}

export { EMPTY_CUPOM_MESSAGE, buildPhysicalTestCupom, buildSaleCupom };
