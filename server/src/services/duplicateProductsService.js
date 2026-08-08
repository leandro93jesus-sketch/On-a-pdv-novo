import { getDb } from '../db/index.js';
import { AppError } from '../utils/errors.js';
import { writeAudit } from './auditService.js';
import { applyStockMovement } from './stockService.js';
import { getCurrentOperator } from './settingsService.js';

export function normalizeProductName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/([a-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[n];
}

function nameSimilarity(a, b) {
  const na = normalizeProductName(a);
  const nb = normalizeProductName(b);
  if (!na || !nb) return { exact: false, similar: false, score: 0 };
  if (na === nb) return { exact: true, similar: true, score: 1 };
  const maxLen = Math.max(na.length, nb.length);
  const dist = levenshtein(na, nb);
  const ratio = 1 - dist / maxLen;
  const tokensA = new Set(na.split(' ').filter(Boolean));
  const tokensB = new Set(nb.split(' ').filter(Boolean));
  let inter = 0;
  for (const t of tokensA) if (tokensB.has(t)) inter += 1;
  const union = tokensA.size + tokensB.size - inter || 1;
  const jaccard = inter / union;
  const similar = ratio >= 0.86 || (jaccard >= 0.8 && ratio >= 0.75);
  return { exact: false, similar, score: Math.max(ratio, jaccard) };
}

function orderedPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

function productBrief(row) {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    barcode: row.barcode,
    price_cents: row.price_cents,
    stock_qty: row.stock_qty,
    category: row.category,
    active: row.active,
    sales_count: row.sales_count ?? 0,
  };
}

function salesCountStmt(db) {
  return db.prepare(
    `SELECT COUNT(*) AS c FROM sale_items WHERE product_id = ?`
  );
}

/**
 * Detecta grupos de possíveis duplicados. Nunca apaga automaticamente.
 */
export function findDuplicateCandidates({ includeInactive = false } = {}) {
  const db = getDb();
  const where = includeInactive ? '' : 'WHERE active = 1';
  const products = db
    .prepare(
      `SELECT id, name, sku, barcode, price_cents, stock_qty, category, active
       FROM products ${where}
       ORDER BY id`
    )
    .all();
  const salesCount = salesCountStmt(db);
  for (const p of products) {
    p.sales_count = salesCount.get(p.id).c;
  }

  const pairs = new Map();
  const addPair = (a, b, match_type, score = 1) => {
    if (a.id === b.id) return;
    const [lo, hi] = orderedPair(a.id, b.id);
    const key = `${lo}:${hi}:${match_type}`;
    if (pairs.has(key)) return;
    pairs.set(key, {
      product_a_id: lo,
      product_b_id: hi,
      match_type,
      score,
      product_a: productBrief(lo === a.id ? a : b),
      product_b: productBrief(hi === a.id ? a : b),
    });
  };

  const byBarcode = new Map();
  const bySku = new Map();
  for (const p of products) {
    if (p.barcode) {
      const k = String(p.barcode).trim();
      if (!byBarcode.has(k)) byBarcode.set(k, []);
      byBarcode.get(k).push(p);
    }
    if (p.sku) {
      const k = String(p.sku).trim().toLowerCase();
      if (!bySku.has(k)) bySku.set(k, []);
      bySku.get(k).push(p);
    }
  }
  for (const group of byBarcode.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) addPair(group[i], group[j], 'barcode', 1);
    }
  }
  for (const group of bySku.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) addPair(group[i], group[j], 'sku', 1);
    }
  }

  for (let i = 0; i < products.length; i++) {
    for (let j = i + 1; j < products.length; j++) {
      const sim = nameSimilarity(products[i].name, products[j].name);
      if (sim.exact) addPair(products[i], products[j], 'name_exact', sim.score);
      else if (sim.similar) addPair(products[i], products[j], 'name_similar', sim.score);
    }
  }

  // Status persistido (não_duplicado / revisar / merged)
  const statusRows = db
    .prepare(
      `SELECT product_a_id, product_b_id, match_type, status, notes, reviewed_by, reviewed_at
       FROM product_duplicate_reviews`
    )
    .all();
  const statusMap = new Map(
    statusRows.map((r) => [`${r.product_a_id}:${r.product_b_id}:${r.match_type}`, r])
  );

  const candidates = [...pairs.values()].map((p) => {
    const st = statusMap.get(`${p.product_a_id}:${p.product_b_id}:${p.match_type}`);
    return {
      ...p,
      status: st?.status || 'pending',
      notes: st?.notes || null,
      reviewed_by: st?.reviewed_by || null,
      reviewed_at: st?.reviewed_at || null,
      label:
        p.match_type === 'name_similar'
          ? 'POSSÍVEL DUPLICIDADE'
          : p.match_type === 'name_exact'
            ? 'NOME IGUAL'
            : p.match_type === 'barcode'
              ? 'CÓDIGO DE BARRAS IGUAL'
              : 'CÓDIGO INTERNO IGUAL',
    };
  });

  // Oculta mesclados e “não é duplicado” do painel principal, mas mantém em totals
  const open = candidates.filter((c) => c.status === 'pending' || c.status === 'review');
  return {
    totals: {
      candidates: candidates.length,
      open: open.length,
      by_type: candidates.reduce((acc, c) => {
        acc[c.match_type] = (acc[c.match_type] || 0) + 1;
        return acc;
      }, {}),
    },
    candidates: open.sort((a, b) => {
      const rank = { barcode: 0, sku: 1, name_exact: 2, name_similar: 3 };
      return (rank[a.match_type] ?? 9) - (rank[b.match_type] ?? 9) || b.score - a.score;
    }),
  };
}

export function findSimilarNameConflicts(name, { excludeId = null } = {}) {
  const db = getDb();
  const products = db
    .prepare(
      `SELECT id, name, sku, barcode, price_cents, stock_qty, category, active
       FROM products WHERE active = 1 AND (? IS NULL OR id != ?)`
    )
    .all(excludeId, excludeId);
  const hits = [];
  for (const p of products) {
    const sim = nameSimilarity(name, p.name);
    if (sim.exact || sim.similar) {
      hits.push({
        ...productBrief(p),
        match_type: sim.exact ? 'name_exact' : 'name_similar',
        score: sim.score,
      });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, 20);
}

export function updateDuplicateReview({
  product_a_id,
  product_b_id,
  match_type,
  status,
  notes = null,
  userName = null,
} = {}) {
  const allowed = new Set(['pending', 'not_duplicate', 'review', 'merged']);
  if (!allowed.has(status)) {
    throw new AppError('Status de revisão inválido', { status: 400, code: 'INVALID_REVIEW_STATUS' });
  }
  const allowedTypes = new Set(['barcode', 'sku', 'name_exact', 'name_similar']);
  if (!allowedTypes.has(match_type)) {
    throw new AppError('Tipo de correspondência inválido', { status: 400, code: 'INVALID_MATCH_TYPE' });
  }
  const [a, b] = orderedPair(Number(product_a_id), Number(product_b_id));
  if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) {
    throw new AppError('Par de produtos inválido', { status: 400, code: 'INVALID_PAIR' });
  }
  const db = getDb();
  db.prepare(
    `INSERT INTO product_duplicate_reviews (
       product_a_id, product_b_id, match_type, status, notes, reviewed_by, reviewed_at
     ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(product_a_id, product_b_id, match_type) DO UPDATE SET
       status = excluded.status,
       notes = excluded.notes,
       reviewed_by = excluded.reviewed_by,
       reviewed_at = datetime('now')`
  ).run(a, b, match_type, status, notes, userName || getCurrentOperator());

  writeAudit({
    action: 'product.duplicate_review',
    entityType: 'product',
    entityId: a,
    details: { product_a_id: a, product_b_id: b, match_type, status, notes },
    userName: userName || getCurrentOperator(),
  });

  return { product_a_id: a, product_b_id: b, match_type, status };
}

export function previewMerge(primaryId, secondaryId) {
  const db = getDb();
  const primary = db.prepare(`SELECT * FROM products WHERE id = ?`).get(Number(primaryId));
  const secondary = db.prepare(`SELECT * FROM products WHERE id = ?`).get(Number(secondaryId));
  if (!primary || !secondary) {
    throw new AppError('Produto não encontrado', { status: 404, code: 'PRODUCT_NOT_FOUND' });
  }
  if (primary.id === secondary.id) {
    throw new AppError('Selecione dois produtos diferentes', { status: 400, code: 'SAME_PRODUCT' });
  }
  const salesCount = salesCountStmt(db);
  const movCount = db.prepare(`SELECT COUNT(*) AS c FROM stock_movements WHERE product_id = ?`);
  const purchaseCount = db.prepare(`SELECT COUNT(*) AS c FROM purchase_items WHERE product_id = ?`);
  return {
    primary: {
      ...productBrief({ ...primary, sales_count: salesCount.get(primary.id).c }),
      movements: movCount.get(primary.id).c,
      purchases: purchaseCount.get(primary.id).c,
    },
    secondary: {
      ...productBrief({ ...secondary, sales_count: salesCount.get(secondary.id).c }),
      movements: movCount.get(secondary.id).c,
      purchases: purchaseCount.get(secondary.id).c,
    },
    stock_rules: {
      sum: primary.stock_qty + secondary.stock_qty,
      keep_primary: primary.stock_qty,
      keep_secondary: secondary.stock_qty,
    },
  };
}

/**
 * Mesclagem segura em transaction.
 * stock_rule: sum | keep_primary | keep_secondary
 */
export function mergeProducts({
  primary_id,
  secondary_id,
  stock_rule = 'sum',
  confirm = false,
  userName = null,
} = {}) {
  if (!confirm) {
    throw new AppError('Confirmação explícita necessária para mesclar', {
      status: 400,
      code: 'CONFIRM_REQUIRED',
    });
  }
  const rules = new Set(['sum', 'keep_primary', 'keep_secondary']);
  if (!rules.has(stock_rule)) {
    throw new AppError('Regra de estoque inválida', { status: 400, code: 'INVALID_STOCK_RULE' });
  }

  const db = getDb();
  const primaryId = Number(primary_id);
  const secondaryId = Number(secondary_id);
  if (primaryId === secondaryId) {
    throw new AppError('Selecione dois produtos diferentes', { status: 400, code: 'SAME_PRODUCT' });
  }

  return db.transaction(() => {
    const primary = db.prepare(`SELECT * FROM products WHERE id = ?`).get(primaryId);
    const secondary = db.prepare(`SELECT * FROM products WHERE id = ?`).get(secondaryId);
    if (!primary || !secondary) {
      throw new AppError('Produto não encontrado', { status: 404, code: 'PRODUCT_NOT_FOUND' });
    }
    if (!primary.active) {
      throw new AppError('Produto principal deve estar ativo', { status: 400, code: 'PRIMARY_INACTIVE' });
    }

    const stockPrimaryBefore = primary.stock_qty;
    const stockSecondaryBefore = secondary.stock_qty;
    let target;
    if (stock_rule === 'sum') target = stockPrimaryBefore + stockSecondaryBefore;
    else if (stock_rule === 'keep_primary') target = stockPrimaryBefore;
    else target = stockSecondaryBefore;

    // Limpa códigos do secundário para não conflitar com UNIQUE parcial
    db.prepare(
      `UPDATE products SET sku = NULL, barcode = NULL, updated_at = datetime('now') WHERE id = ?`
    ).run(secondaryId);

    // Consolida estoque do principal via movimentação
    const deltaPrimary = target - stockPrimaryBefore;
    if (deltaPrimary !== 0) {
      applyStockMovement(
        {
          productId: primaryId,
          movementType: deltaPrimary > 0 ? 'adjust_in' : 'adjust_out',
          quantity: Math.abs(deltaPrimary),
          reason: `Mesclagem com produto #${secondaryId} (regra: ${stock_rule})`,
          userName: userName || getCurrentOperator(),
          referenceType: 'product_merge',
          referenceId: secondaryId,
          note: `Estoque consolidado: principal=${stockPrimaryBefore}, secundário=${stockSecondaryBefore}, alvo=${target}`,
          allowNegative: true,
        },
        { db, skipAudit: true }
      );
    }

    // Zera secundário via movimentação (nunca UPDATE direto de saldo)
    if (stockSecondaryBefore > 0) {
      applyStockMovement(
        {
          productId: secondaryId,
          movementType: 'exit',
          quantity: stockSecondaryBefore,
          reason: `Mesclagem: estoque transferido/consolidado no produto #${primaryId}`,
          userName: userName || getCurrentOperator(),
          referenceType: 'product_merge',
          referenceId: primaryId,
          note: `Regra ${stock_rule}`,
          allowNegative: true,
        },
        { db, skipAudit: true }
      );
    }

    // Reatribui referências (histórico preservado no produto principal)
    const sales = db
      .prepare(`UPDATE sale_items SET product_id = ? WHERE product_id = ?`)
      .run(primaryId, secondaryId).changes;
    const movements = db
      .prepare(`UPDATE stock_movements SET product_id = ? WHERE product_id = ?`)
      .run(primaryId, secondaryId).changes;
    const purchases = db
      .prepare(`UPDATE purchase_items SET product_id = ? WHERE product_id = ?`)
      .run(primaryId, secondaryId).changes;
    let returns = 0;
    try {
      returns = db
        .prepare(`UPDATE return_items SET product_id = ? WHERE product_id = ?`)
        .run(primaryId, secondaryId).changes;
    } catch {
      /* tabela pode não existir em DBs muito antigos */
    }

    db.prepare(
      `UPDATE products SET active = 0, updated_at = datetime('now'),
         notes = TRIM(COALESCE(notes,'') || ' [Mesclado no produto #' || ? || ']')
       WHERE id = ?`
    ).run(String(primaryId), secondaryId);

    const stockAfter = db.prepare(`SELECT stock_qty FROM products WHERE id = ?`).get(primaryId)
      .stock_qty;

    // Copia barcode/sku do secundário se o principal não tiver
    if (!primary.barcode && secondary.barcode) {
      const clash = db
        .prepare(`SELECT id FROM products WHERE barcode = ? AND id != ?`)
        .get(secondary.barcode, primaryId);
      if (!clash) {
        db.prepare(`UPDATE products SET barcode = ?, updated_at = datetime('now') WHERE id = ?`).run(
          secondary.barcode,
          primaryId
        );
      }
    }
    if (!primary.sku && secondary.sku) {
      const clash = db
        .prepare(`SELECT id FROM products WHERE sku = ? AND id != ?`)
        .get(secondary.sku, primaryId);
      if (!clash) {
        db.prepare(`UPDATE products SET sku = ?, updated_at = datetime('now') WHERE id = ?`).run(
          secondary.sku,
          primaryId
        );
      }
    }

    const [a, b] = orderedPair(primaryId, secondaryId);
    for (const match_type of ['barcode', 'sku', 'name_exact', 'name_similar']) {
      db.prepare(
        `INSERT INTO product_duplicate_reviews (
           product_a_id, product_b_id, match_type, status, notes, reviewed_by, reviewed_at
         ) VALUES (?, ?, ?, 'merged', 'Mesclado', ?, datetime('now'))
         ON CONFLICT(product_a_id, product_b_id, match_type) DO UPDATE SET
           status = 'merged', reviewed_by = excluded.reviewed_by, reviewed_at = datetime('now')`
      ).run(a, b, match_type, userName || getCurrentOperator());
    }

    const details = {
      sales_reassigned: sales,
      movements_reassigned: movements,
      purchases_reassigned: purchases,
      returns_reassigned: returns,
      secondary_name: secondary.name,
      primary_name: primary.name,
    };

    const info = db
      .prepare(
        `INSERT INTO product_merges (
           primary_product_id, secondary_product_id, stock_rule,
           stock_primary_before, stock_secondary_before, stock_after,
           sales_reassigned, movements_reassigned, details_json, created_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        primaryId,
        secondaryId,
        stock_rule,
        stockPrimaryBefore,
        stockSecondaryBefore,
        stockAfter,
        sales,
        movements,
        JSON.stringify(details),
        userName || getCurrentOperator()
      );

    writeAudit({
      action: 'product.merge',
      entityType: 'product',
      entityId: primaryId,
      details: {
        merge_id: Number(info.lastInsertRowid),
        secondary_id: secondaryId,
        stock_rule,
        stock_primary_before: stockPrimaryBefore,
        stock_secondary_before: stockSecondaryBefore,
        stock_after: stockAfter,
        ...details,
      },
      userName: userName || getCurrentOperator(),
    });

    return {
      merge_id: Number(info.lastInsertRowid),
      primary_id: primaryId,
      secondary_id: secondaryId,
      stock_rule,
      stock_primary_before: stockPrimaryBefore,
      stock_secondary_before: stockSecondaryBefore,
      stock_after: stockAfter,
      ...details,
    };
  })();
}
