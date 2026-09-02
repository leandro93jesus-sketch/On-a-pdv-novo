import { enqueuePrintJobApi, markPrintJobResultApi } from '../api/client';

export type PrintKind = 'receipt' | 'report' | 'delivery';

/**
 * Relatórios / entregas: diálogo de impressão da tela atual.
 * Cupom de venda NÃO passa por aqui — use printSaleReceipt (ESC/POS / janela isolada).
 */
export async function printDocument(opts: {
  kind?: PrintKind;
  title: string;
  documentType?: string;
  documentRef?: string;
  printerName?: string;
  paperFormat?: string;
  copies?: number;
}): Promise<{ ok: boolean; error?: string; jobId?: number }> {
  const kind = opts.kind || 'receipt';
  let jobId: number | undefined;
  try {
    const job = await enqueuePrintJobApi({
      document_type: opts.documentType || kind,
      document_ref: opts.documentRef,
      title: opts.title,
      printer_name: opts.printerName,
      paper_format: opts.paperFormat,
      copies: opts.copies,
      kind,
    });
    jobId = job.id;
  } catch {
    /* fila opcional — continua impressão */
  }

  try {
    if (kind === 'receipt') {
      const error = 'IMPRESSÃO CANCELADA\nO cupom não foi gerado corretamente.';
      if (jobId != null) {
        await markPrintJobResultApi(jobId, { ok: false, error, printer_name: opts.printerName }).catch(
          () => undefined
        );
      }
      return { ok: false, error, jobId };
    }

    window.print();
    if (jobId != null) {
      await markPrintJobResultApi(jobId, {
        ok: true,
        printer_name: opts.printerName || 'navegador',
      }).catch(() => undefined);
    }
    return { ok: true, jobId };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Falha na impressão';
    if (jobId != null) {
      await markPrintJobResultApi(jobId, {
        ok: false,
        error,
        printer_name: opts.printerName,
      }).catch(() => undefined);
    }
    return { ok: false, error, jobId };
  }
}
