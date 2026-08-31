import {
  buildReceiptPdfUrl,
  generateSaleReceiptPdfApi,
  type ReceiptPdfMeta,
  type Sale,
} from '../api/client';
import { printDocument } from './printDocument';
import { savePdfToComputer } from './savePdf';

/**
 * Impressão e PDF de uma venda já registrada.
 *
 * As duas rotinas são as mesmas usadas pelo comprovante da venda (printDocument
 * e savePdfToComputer): não existe implementação paralela de impressão. São
 * SOMENTE LEITURA — não alteram venda, itens, pagamento, estoque nem caixa.
 */

export async function printSaleReceipt(
  sale: Sale,
  opts: { printerName?: string; paperFormat?: string; reprint?: boolean } = {}
): Promise<{ ok: boolean; error?: string }> {
  return printDocument({
    kind: 'receipt',
    // Marca discreta de reimpressão: fica no título e na fila de impressão,
    // sem mudar nenhum valor do comprovante.
    title: opts.reprint
      ? `REIMPRESSÃO — Comprovante ${sale.sale_number}`
      : `Comprovante ${sale.sale_number}`,
    documentType: opts.reprint ? 'comprovante_reimpressao' : 'comprovante',
    documentRef: sale.sale_number,
    printerName: opts.printerName,
    paperFormat: opts.paperFormat,
  });
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
