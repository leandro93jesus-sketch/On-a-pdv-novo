import {
  buildReceiptPdfUrl,
  enqueuePrintJobApi,
  generateSaleReceiptPdfApi,
  markPrintJobResultApi,
  type ReceiptPdfMeta,
  type Sale,
} from '../api/client';
import { savePdfToComputer } from './savePdf';
import { EMPTY_CUPOM_MESSAGE } from './print/cupomValidate';
import { getDefaultPrintService, type PrintServiceResult } from './print/printService';

/**
 * Impressão e PDF de uma venda já registrada.
 * Impressão passa SOMENTE pelo PrintService — o mesmo do teste e da reimpressão.
 * SOMENTE LEITURA — não altera venda, itens, pagamento, estoque nem caixa.
 */

export function previewSaleReceipt(
  sale: Sale,
  opts: { paperFormat?: string; reprint?: boolean; company?: string } = {}
) {
  return getDefaultPrintService().previewSale(sale, opts);
}

export async function printSaleReceipt(
  sale: Sale,
  opts: { paperFormat?: string; reprint?: boolean; company?: string } = {}
): Promise<PrintServiceResult> {
  const res = await getDefaultPrintService().printSale(sale, opts);
  try {
    const queued = await enqueuePrintJobApi({
      document_type: opts.reprint ? 'comprovante_reimpressao' : 'comprovante',
      document_ref: sale.sale_number,
      title: opts.reprint
        ? `REIMPRESSÃO — Comprovante ${sale.sale_number}`
        : `Comprovante ${sale.sale_number}`,
      printer_name: res.deviceName,
      paper_format: opts.paperFormat || '80mm',
      kind: 'receipt',
    });
    await markPrintJobResultApi(queued.id, {
      ok: Boolean(res.ok),
      error: res.error,
      printer_name: res.deviceName,
    }).catch(() => undefined);
  } catch {
    /* fila opcional */
  }
  if (!res.ok && !res.error) {
    return { ...res, error: EMPTY_CUPOM_MESSAGE };
  }
  return res;
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
