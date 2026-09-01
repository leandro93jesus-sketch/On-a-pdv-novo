import {
  enqueuePrintJobApi,
  markPrintJobResultApi,
  logDirectPrintApi,
} from '../api/client';

export type PrintKind = 'receipt' | 'report' | 'delivery';

/**
 * Impressão unificada: tenta desktop silent print; senão window.print.
 * Nunca lança erro que cancele venda — retorna { ok, error }.
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
    if (window.oncaDesktop?.testPrint) {
      const res = await window.oncaDesktop.testPrint({
        deviceName: opts.printerName || undefined,
        copies: opts.copies || 1,
      });
      if (jobId != null) {
        await markPrintJobResultApi(jobId, {
          ok: Boolean(res.ok),
          error: res.error,
          printer_name: opts.printerName,
        }).catch(() => undefined);
      } else {
        await logDirectPrintApi({
          document_type: opts.documentType || kind,
          document_ref: opts.documentRef,
          printer_name: opts.printerName,
          paper_format: opts.paperFormat,
          result: res.ok ? 'ok' : 'erro',
          error_message: res.error,
        }).catch(() => undefined);
      }
      return { ok: Boolean(res.ok), error: res.error, jobId };
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
