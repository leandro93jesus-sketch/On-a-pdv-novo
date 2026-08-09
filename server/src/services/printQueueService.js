import { getDb } from '../db/index.js';
import { AppError } from '../utils/errors.js';
import { getCurrentOperator } from './settingsService.js';
import { resolvePrinterFor } from './printerSettingsService.js';

const FORMATS = new Set(['A4', '80mm', '58mm']);
const STATUSES = new Set(['pendente', 'impresso', 'erro']);

export function enqueuePrintJob(payload = {}) {
  const db = getDb();
  const documentType = String(payload.document_type || 'comprovante').trim();
  const title = String(payload.title || 'Documento ONÇA PDV').trim();
  if (!documentType || !title) {
    throw new AppError('Documento inválido', { status: 400, code: 'INVALID_PRINT_DOC' });
  }
  const resolved = resolvePrinterFor(payload.kind || 'receipt');
  const paper =
    payload.paper_format && FORMATS.has(String(payload.paper_format))
      ? String(payload.paper_format)
      : resolved.format || 'A4';
  const copies = Math.max(1, Math.min(10, Number(payload.copies || resolved.copies || 1)));
  const printerName =
    payload.printer_name != null && String(payload.printer_name).trim()
      ? String(payload.printer_name).trim()
      : resolved.deviceName || null;

  const info = db
    .prepare(
      `INSERT INTO print_jobs (
         document_type, document_ref, title, printer_name, paper_format, copies,
         payload_json, status, user_name
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pendente', ?)`
    )
    .run(
      documentType,
      payload.document_ref != null ? String(payload.document_ref) : null,
      title,
      printerName,
      paper,
      copies,
      payload.payload_json ? JSON.stringify(payload.payload_json) : null,
      payload.user_name || getCurrentOperator()
    );

  return getPrintJob(Number(info.lastInsertRowid));
}

export function getPrintJob(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(Number(id));
  if (!row) throw new AppError('Trabalho de impressão não encontrado', { status: 404, code: 'PRINT_JOB_NOT_FOUND' });
  return {
    ...row,
    payload_json: row.payload_json ? JSON.parse(row.payload_json) : null,
  };
}

export function listPrintJobs({ status, limit = 100 } = {}) {
  const db = getDb();
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 300);
  if (status) {
    if (!STATUSES.has(status)) {
      throw new AppError('Status inválido', { status: 400, code: 'INVALID_PRINT_STATUS' });
    }
    return db
      .prepare(`SELECT * FROM print_jobs WHERE status = ? ORDER BY id DESC LIMIT ?`)
      .all(status, safeLimit)
      .map((r) => ({ ...r, payload_json: r.payload_json ? JSON.parse(r.payload_json) : null }));
  }
  return db
    .prepare(`SELECT * FROM print_jobs ORDER BY id DESC LIMIT ?`)
    .all(safeLimit)
    .map((r) => ({ ...r, payload_json: r.payload_json ? JSON.parse(r.payload_json) : null }));
}

export function markPrintJobResult(id, { ok, error, printer_name, user_name } = {}) {
  const db = getDb();
  const job = getPrintJob(id);
  const status = ok ? 'impresso' : 'erro';
  const printerName = printer_name != null ? String(printer_name) : job.printer_name;
  const user = user_name || getCurrentOperator();

  return db.transaction(() => {
    db.prepare(
      `UPDATE print_jobs
       SET status = ?, error_message = ?, printer_name = ?, updated_at = datetime('now'),
           printed_at = CASE WHEN ? = 'impresso' THEN datetime('now') ELSE printed_at END
       WHERE id = ?`
    ).run(status, ok ? null : String(error || 'Falha na impressão'), printerName, status, Number(id));

    db.prepare(
      `INSERT INTO print_log (
         print_job_id, document_type, document_ref, printer_name, paper_format,
         user_name, result, error_message
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      Number(id),
      job.document_type,
      job.document_ref,
      printerName,
      job.paper_format,
      user,
      ok ? 'ok' : 'erro',
      ok ? null : String(error || 'Falha na impressão')
    );

    return getPrintJob(id);
  })();
}

export function requeuePrintJob(id) {
  const db = getDb();
  getPrintJob(id);
  db.prepare(
    `UPDATE print_jobs
     SET status = 'pendente', error_message = NULL, updated_at = datetime('now')
     WHERE id = ?`
  ).run(Number(id));
  return getPrintJob(id);
}

export function listPrintLog({ limit = 100 } = {}) {
  const db = getDb();
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 300);
  return db.prepare(`SELECT * FROM print_log ORDER BY id DESC LIMIT ?`).all(safeLimit);
}

export function logDirectPrint({
  document_type,
  document_ref,
  printer_name,
  paper_format,
  ok,
  result,
  error,
  error_message,
  user_name,
} = {}) {
  const db = getDb();
  const resolved =
    result === 'ok' || result === 'erro' || result === 'cancelado'
      ? result
      : ok
        ? 'ok'
        : 'erro';
  const errMsg = error_message || error;
  db.prepare(
    `INSERT INTO print_log (
       document_type, document_ref, printer_name, paper_format, user_name, result, error_message
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    String(document_type || 'comprovante'),
    document_ref != null ? String(document_ref) : null,
    printer_name || null,
    paper_format || null,
    user_name || getCurrentOperator(),
    resolved,
    resolved === 'ok' ? null : String(errMsg || 'Falha')
  );
}
