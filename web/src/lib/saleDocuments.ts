import {
  buildReceiptPdfUrl,
  enqueuePrintJobApi,
  fetchPrinterSettings,
  generateSaleReceiptPdfApi,
  markPrintJobResultApi,
  type ReceiptPdfMeta,
  type Sale,
} from '../api/client';
import { savePdfToComputer } from './savePdf';
import { EMPTY_CUPOM_MESSAGE } from './print/cupomValidate';
import { createDesktopTransport } from './print/desktopTransport';
import { dispatchCupom, prepareCupomJob, previewSaleCupom } from './print/printReceipt';
import type { CupomWidth } from './print/cupomBuilder';

/**
 * Impressão e PDF de uma venda já registrada.
 *
 * As duas rotinas são as mesmas usadas pelo comprovante da venda (printDocument
 * e savePdfToComputer): não existe implementação paralela de impressão. São
 * SOMENTE LEITURA — não alteram venda, itens, pagamento, estoque nem caixa.
 */

export function previewSaleReceipt(
  sale: Sale,
  opts: { paperFormat?: string; reprint?: boolean; company?: string } = {}
) {
  const width = (opts.paperFormat as CupomWidth) || '80mm';
  return previewSaleCupom(sale, {
    company: opts.company,
    width: width === 'A4' ? '80mm' : width,
    reprint: opts.reprint,
  });
}

export async function printSaleReceipt(
  sale: Sale,
  opts: { printerName?: string; paperFormat?: string; reprint?: boolean; company?: string } = {}
): Promise<{ ok: boolean; error?: string }> {
  const settings = await fetchPrinterSettings().catch(() => null);
  const width = (opts.paperFormat || settings?.profile.format || '80mm') as CupomWidth;
  const preview = previewSaleReceipt(sale, {
    paperFormat: width,
    reprint: opts.reprint,
    company: opts.company,
  });
  if (!preview.ok) {
    return { ok: false, error: preview.error || EMPTY_CUPOM_MESSAGE };
  }
  try {
    const job = prepareCupomJob(preview.cupom, {
      method: (settings?.method as 'windows' | 'escpos' | 'tcp') || 'escpos',
      cut: settings?.cut !== false,
      printerName: opts.printerName || settings?.receipt_printer || settings?.default_printer || undefined,
      host: settings?.tcp_host,
      port: settings?.tcp_port,
    });
    let jobId: number | undefined;
    try {
      const queued = await enqueuePrintJobApi({
        document_type: opts.reprint ? 'comprovante_reimpressao' : 'comprovante',
        document_ref: sale.sale_number,
        title: opts.reprint
          ? `REIMPRESSÃO — Comprovante ${sale.sale_number}`
          : `Comprovante ${sale.sale_number}`,
        printer_name: job.printerName,
        paper_format: job.width,
        kind: 'receipt',
      });
      jobId = queued.id;
    } catch {
      /* fila opcional */
    }
    const res = await dispatchCupom(job, createDesktopTransport());
    if (jobId != null) {
      await markPrintJobResultApi(jobId, {
        ok: Boolean(res.ok),
        error: res.error,
        printer_name: job.printerName,
      }).catch(() => undefined);
    }
    return { ok: Boolean(res.ok), error: res.error };
  } catch (e) {
    const error = e instanceof Error ? e.message : EMPTY_CUPOM_MESSAGE;
    return { ok: false, error };
  }
}

export async function saveSaleReceiptPdf(
  sale: Sale
): Promise<{ ok: boolean; canceled?: boolean; filePath?: string; error?: string; meta?: ReceiptPdfMeta }> {
  const meta = await generateSaleReceiptPdfApi(sale.id, { force: false });
  const result = await savePdfToComputer({
    suggestedName: meta.filename || `ONCA-VENDA-${sale.sale_number}.pdf`,
    downloadUrl: meta.download_url || buildReceiptPdfUrl(sale.id, { download: true }),
    absolutePath: meta.absolute_path,
    title: 'Salvar comprovante em PDF',
  });
  return { ...result, meta };
}
