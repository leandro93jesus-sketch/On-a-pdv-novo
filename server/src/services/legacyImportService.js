import { createHash } from 'node:crypto';
import { getDb } from '../db/index.js';
import { AppError } from '../utils/errors.js';
import { writeAudit } from './auditService.js';
import { createBackup } from './backupService.js';
import { analyzeJsonStructure } from './legacyImport/analyze.js';
import { toIntermediateModel, buildPreview } from './legacyImport/mapGeneric.js';

export const IMPORTER_VERSION = '0.4.0-generic';

function sha256Buffer(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function normalizePayment(method) {
  const m = String(method || 'dinheiro')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  if (m.includes('pix')) return 'pix';
  if (m.includes('cart')) return 'cartao';
  if (m.includes('credit') || m.includes('crediario') || m.includes('prazo')) return 'crediario';
  return 'dinheiro';
}

export function parseLegacyJsonBuffer(buffer, { filename = 'backup.json' } = {}) {
  if (!buffer || buffer.length === 0) {
    throw new AppError('Arquivo vazio', { status: 400, code: 'EMPTY_FILE' });
  }
  if (buffer.length > 80 * 1024 * 1024) {
    throw new AppError('Arquivo JSON muito grande (>80MB)', { status: 400, code: 'FILE_TOO_LARGE' });
  }
  let text;
  try {
    text = buffer.toString('utf8');
  } catch {
    throw new AppError('Não foi possível ler o arquivo como UTF-8', { status: 400, code: 'INVALID_ENCODING' });
  }
  if (!text.trim()) {
    throw new AppError('JSON vazio', { status: 400, code: 'EMPTY_JSON' });
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new AppError(`JSON inválido: ${err.message}`, { status: 400, code: 'INVALID_JSON' });
  }
  const sha256 = sha256Buffer(buffer);
  const analysis = analyzeJsonStructure(data, {
    filename,
    sizeBytes: buffer.length,
    sha256,
  });
  const model = toIntermediateModel(data, analysis);
  const preview = buildPreview(model, analysis);
  return { data, analysis, model, preview, sha256, filename };
}

export function createPreviewRun(parsed, { createdBy = null } = {}) {
  const info = getDb()
    .prepare(
      `INSERT INTO import_runs (source_filename, source_sha256, importer_version, status, preview_json, unknown_fields_json, created_by)
       VALUES (?, ?, ?, 'preview', ?, ?, ?)`
    )
    .run(
      parsed.filename,
      parsed.sha256,
      IMPORTER_VERSION,
      JSON.stringify(parsed.preview),
      JSON.stringify(parsed.model.unknown_fields),
      createdBy
    );
  return {
    id: Number(info.lastInsertRowid),
    preview: parsed.preview,
    analysis: parsed.analysis,
    importer_version: IMPORTER_VERSION,
    sha256: parsed.sha256,
    status: 'preview',
  };
}

function findExistingProduct(db, p) {
  if (p.legacy_id) {
    const byLegacy = db
      .prepare(`SELECT id FROM products WHERE legacy_source = ? AND legacy_id = ?`)
      .get(p.legacy_source, p.legacy_id);
    if (byLegacy) return { id: byLegacy.id, reason: 'legacy_id' };
  }
  if (p.barcode) {
    const byBar = db.prepare(`SELECT id FROM products WHERE barcode = ?`).get(p.barcode);
    if (byBar) return { id: byBar.id, reason: 'barcode' };
  }
  if (p.sku) {
    const bySku = db.prepare(`SELECT id FROM products WHERE sku = ?`).get(p.sku);
    if (bySku) return { id: bySku.id, reason: 'sku' };
  }
  return null;
}

/**
 * Importação em transaction. Rollback completo em erro crítico.
 * Usa mapeamento genérico — NÃO é o adaptador do backup real.
 */
export function executeImport(parsed, { createdBy = null, confirm = false, runId = null } = {}) {
  if (!confirm) {
    throw new AppError('Confirmação explícita necessária', { status: 400, code: 'CONFIRM_REQUIRED' });
  }

  const safety = createBackup({
    kind: 'pre_import',
    createdBy,
    notes: `Backup automático antes de importar ${parsed.filename}`,
  });

  const db = getDb();
  let importRunId = runId;
  if (!importRunId) {
    importRunId = createPreviewRun(parsed, { createdBy }).id;
  }

  db.prepare(
    `UPDATE import_runs SET status = 'running', backup_history_id = ?, started_at = datetime('now') WHERE id = ?`
  ).run(safety.id, importRunId);

  const report = {
    found: {
      products: parsed.model.products.length,
      customers: parsed.model.customers.length,
      suppliers: parsed.model.suppliers.length,
      sales: parsed.model.sales.length,
    },
    imported: { products: 0, customers: 0, suppliers: 0, sales: 0, sale_items: 0 },
    ignored: { products: 0, customers: 0, suppliers: 0, sales: 0 },
    duplicated: { products: 0, customers: 0, suppliers: 0, sales: 0 },
    converted: { money_fields: 0 },
    errors: [],
    unknown_fields: parsed.model.unknown_fields,
    sha256: parsed.sha256,
    filename: parsed.filename,
    importer_version: IMPORTER_VERSION,
    safety_backup_id: safety.id,
    started_at: new Date().toISOString(),
  };

  const started = Date.now();
  const productIdByLegacy = new Map();
  const customerIdByLegacy = new Map();

  try {
    const tx = db.transaction(() => {
      for (const p of parsed.model.products) {
        const existing = findExistingProduct(db, p);
        if (existing) {
          report.duplicated.products += 1;
          report.ignored.products += 1;
          productIdByLegacy.set(String(p.legacy_id), existing.id);
          continue;
        }
        const info = db
          .prepare(
            `INSERT INTO products (sku, barcode, name, category, unit, price_cents, cost_cents, stock_qty, min_stock_qty, legacy_id, legacy_source)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            p.sku,
            p.barcode,
            p.name,
            p.category,
            p.unit,
            p.price_cents,
            p.cost_cents,
            p.stock_qty,
            p.min_stock_qty,
            p.legacy_id,
            p.legacy_source
          );
        const id = Number(info.lastInsertRowid);
        productIdByLegacy.set(String(p.legacy_id), id);
        if (p.stock_qty) {
          db.prepare(
            `INSERT INTO stock_movements (product_id, movement_type, quantity_delta, stock_after, reference_type, reference_id, note, reason, user_name)
             VALUES (?, 'entry', ?, ?, 'import', ?, 'Importação JSON legado', 'importacao_legado', ?)`
          ).run(id, p.stock_qty, p.stock_qty, importRunId, createdBy || 'import');
        }
        report.imported.products += 1;
        report.converted.money_fields += 2;
      }

      for (const c of parsed.model.customers) {
        let existing = null;
        if (c.legacy_id) {
          existing = db
            .prepare(`SELECT id FROM customers WHERE legacy_source = ? AND legacy_id = ?`)
            .get(c.legacy_source, c.legacy_id);
        }
        if (!existing && c.document) {
          existing = db.prepare(`SELECT id FROM customers WHERE document = ?`).get(c.document);
        }
        if (existing) {
          report.duplicated.customers += 1;
          report.ignored.customers += 1;
          customerIdByLegacy.set(String(c.legacy_id), existing.id);
          continue;
        }
        const info = db
          .prepare(
            `INSERT INTO customers (name, document, phone, whatsapp, address, city, state, legacy_id, legacy_source)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            c.name,
            c.document,
            c.phone,
            c.whatsapp,
            c.address,
            c.city,
            c.state,
            c.legacy_id,
            c.legacy_source
          );
        customerIdByLegacy.set(String(c.legacy_id), Number(info.lastInsertRowid));
        report.imported.customers += 1;
      }

      for (const s of parsed.model.suppliers) {
        let existing = null;
        if (s.legacy_id) {
          existing = db
            .prepare(`SELECT id FROM suppliers WHERE legacy_source = ? AND legacy_id = ?`)
            .get(s.legacy_source, s.legacy_id);
        }
        if (!existing && s.document) {
          existing = db.prepare(`SELECT id FROM suppliers WHERE document = ?`).get(s.document);
        }
        if (existing) {
          report.duplicated.suppliers += 1;
          report.ignored.suppliers += 1;
          continue;
        }
        db.prepare(
          `INSERT INTO suppliers (name, trade_name, document, phone, city, state, legacy_id, legacy_source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          s.name,
          s.trade_name,
          s.document,
          s.phone,
          s.city,
          s.state,
          s.legacy_id,
          s.legacy_source
        );
        report.imported.suppliers += 1;
      }

      for (const sale of parsed.model.sales) {
        if (sale.legacy_id) {
          const existing = db
            .prepare(`SELECT id FROM sales WHERE legacy_source = ? AND legacy_id = ?`)
            .get(sale.legacy_source, sale.legacy_id);
          if (existing) {
            report.duplicated.sales += 1;
            report.ignored.sales += 1;
            continue;
          }
        }

        const saleNumber = `IMP-${String(sale.legacy_id).slice(0, 24)}-${Date.now().toString(36)}`;
        const items = sale.items?.length
          ? sale.items
          : [{ name: 'Item importado', quantity: 1, unit_price_cents: sale.total_cents }];
        const subtotal = items.reduce((a, it) => a + it.unit_price_cents * it.quantity, 0);
        const total = sale.total_cents || Math.max(0, subtotal - (sale.discount_cents || 0));
        const customerId = sale.customer_legacy_id
          ? customerIdByLegacy.get(String(sale.customer_legacy_id)) || null
          : null;

        const info = db
          .prepare(
            `INSERT INTO sales (sale_number, status, subtotal_cents, discount_cents, total_cents, notes, customer_id, legacy_id, legacy_source, created_at)
             VALUES (?, 'completed', ?, ?, ?, 'Importado do JSON legado', ?, ?, ?, COALESCE(?, datetime('now')))`
          )
          .run(
            saleNumber,
            subtotal,
            sale.discount_cents || 0,
            total,
            customerId,
            sale.legacy_id,
            sale.legacy_source,
            sale.created_at
          );
        const saleId = Number(info.lastInsertRowid);
        for (const it of items) {
          const productId = it.product_legacy_id
            ? productIdByLegacy.get(String(it.product_legacy_id)) || null
            : null;
          const line = it.unit_price_cents * it.quantity;
          db.prepare(
            `INSERT INTO sale_items (sale_id, product_id, name, unit_price_cents, quantity, discount_cents, line_total_cents, is_misc)
             VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
          ).run(saleId, productId, it.name, it.unit_price_cents, it.quantity, line, productId ? 0 : 1);
          report.imported.sale_items += 1;
        }
        const method = normalizePayment(sale.payment_method);
        // crediário em venda importada sem fluxo de caixa/parcelas — usa dinheiro se crediario sem conta
        const payMethod = method === 'crediario' ? 'dinheiro' : method;
        db.prepare(`INSERT INTO sale_payments (sale_id, method, amount_cents) VALUES (?, ?, ?)`).run(
          saleId,
          payMethod,
          total
        );
        report.imported.sales += 1;
        report.converted.money_fields += 1;
      }

      // Falha forçada para testes via marcador especial
      if (parsed.data && parsed.data.__force_fail === true) {
        throw new Error('Falha simulada para teste de rollback');
      }
    });

    tx();

    const validation = postImportValidation(parsed.model, report);
    report.finished_at = new Date().toISOString();
    report.elapsed_ms = Date.now() - started;
    report.validation = validation;
    report.status = validation.ok ? 'completed' : 'completed_with_warnings';

    db.prepare(
      `UPDATE import_runs SET status = 'completed', report_json = ?, finished_at = datetime('now') WHERE id = ?`
    ).run(JSON.stringify(report), importRunId);

    writeAudit({
      action: 'import.legacy_json',
      entityType: 'import_run',
      entityId: importRunId,
      details: {
        filename: parsed.filename,
        sha256: parsed.sha256,
        imported: report.imported,
      },
      userName: createdBy,
    });

    return { id: importRunId, report, safety_backup: safety };
  } catch (err) {
    db.prepare(
      `UPDATE import_runs SET status = 'failed', error_message = ?, finished_at = datetime('now'), report_json = ? WHERE id = ?`
    ).run(String(err.message || err), JSON.stringify(report), importRunId);
    writeAudit({
      action: 'import.legacy_json_failed',
      entityType: 'import_run',
      entityId: importRunId,
      details: { error: String(err.message || err), sha256: parsed.sha256 },
      userName: createdBy,
      result: 'fail',
    });
    if (err instanceof AppError) throw err;
    throw new AppError(`Importação abortada (rollback): ${err.message}`, {
      status: 500,
      code: 'IMPORT_ROLLBACK',
      details: { import_run_id: importRunId, safety_backup_id: safety.id },
    });
  }
}

function postImportValidation(model, report) {
  const db = getDb();
  db.pragma('foreign_keys = ON');
  const integrity = db.pragma('integrity_check')[0]?.integrity_check;
  const fk = db.pragma('foreign_key_check');
  const neg = db
    .prepare(`SELECT COUNT(*) AS c FROM products WHERE stock_qty < 0 AND allow_negative_stock = 0`)
    .get().c;
  const orphanItems = db
    .prepare(
      `SELECT COUNT(*) AS c FROM sale_items si LEFT JOIN sales s ON s.id = si.sale_id WHERE s.id IS NULL`
    )
    .get().c;

  return {
    ok: integrity === 'ok' && fk.length === 0 && neg === 0 && orphanItems === 0,
    integrity_check: integrity,
    foreign_key_violations: fk.length,
    negative_stock: neg,
    orphan_sale_items: orphanItems,
    counts: {
      products_db: db.prepare('SELECT COUNT(*) AS c FROM products').get().c,
      customers_db: db.prepare('SELECT COUNT(*) AS c FROM customers').get().c,
      suppliers_db: db.prepare('SELECT COUNT(*) AS c FROM suppliers').get().c,
      sales_db: db.prepare('SELECT COUNT(*) AS c FROM sales').get().c,
      products_imported: report.imported.products,
      expected_products_in_file: model.products.length,
    },
  };
}

export function listImportRuns() {
  return getDb()
    .prepare(`SELECT id, source_filename, source_sha256, importer_version, status, started_at, finished_at, created_by, error_message, backup_history_id
              FROM import_runs ORDER BY id DESC LIMIT 100`)
    .all();
}

export function getImportRun(id) {
  const row = getDb().prepare('SELECT * FROM import_runs WHERE id = ?').get(id);
  if (!row) throw new AppError('Importação não encontrada', { status: 404, code: 'NOT_FOUND' });
  return {
    ...row,
    preview: row.preview_json ? JSON.parse(row.preview_json) : null,
    report: row.report_json ? JSON.parse(row.report_json) : null,
    unknown_fields: row.unknown_fields_json ? JSON.parse(row.unknown_fields_json) : [],
  };
}
