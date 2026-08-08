/**
 * Adaptador DEFINITIVO para o backup JSON real "Oncas PDV" (version 2).
 * Fonte analisada: oncas-pdv-backup-2026-08-07-*.json
 * SHA-256: 6389a693b4f9f2f0d6c8b1781e633767db5e32913a26933d7c43212d0a112d70
 *
 * NÃO altera o arquivo JSON. Importação definitiva só com autorização.
 */
import { parseLegacyMoneyToCents } from '../../utils/moneyLegacy.js';

export const ADAPTER_ID = 'oncas_pdv_v2';
export const LEGACY_SOURCE = 'oncas_pdv_v2';
export const ADAPTER_VERSION = '1.0.0';

function pickMoney(value, field) {
  if (value == null || value === '') return 0;
  return parseLegacyMoneyToCents(value, { field, required: true });
}

function cleanText(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === '-' || s === '0') return null;
  return s;
}

function cleanDocument(v) {
  const s = cleanText(v);
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  return digits || null;
}

function looksLikeBarcode(code) {
  const c = String(code || '');
  return /^\d{8,14}$/.test(c);
}

function isJunkCode(code) {
  const c = String(code || '');
  return !c || /^https?/i.test(c) || /qrco/i.test(c) || c.includes('Ç') || c.includes(';');
}

function mapPayment(method) {
  const m = String(method || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  if (m.includes('pix')) return 'pix';
  if (m.includes('dinheiro')) return 'dinheiro';
  if (m.includes('cartao') || m.includes('credito') || m.includes('debito')) return 'cartao';
  if (m.includes('crediario') || m.includes('fiado') || m === 'prazo') return 'crediario';
  return 'dinheiro';
}

function isMiscItem(it) {
  if (!it) return true;
  if (it.diverso === true) return true;
  if (typeof it.id === 'number' && it.id < 0) return true;
  const name = String(it.name || '');
  if (/^diverso/i.test(name.trim())) return true;
  return false;
}

/**
 * Detecta se o JSON é o backup real Oncas PDV v2.
 */
export function matchesOncasPdvV2(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const hasProducts = Array.isArray(data.products);
  const hasSales = Array.isArray(data.sales);
  const hasBackupMeta = data.backup && (data.backup.app === 'Oncas PDV' || data.backup.version === 2);
  const hasStockMovements = Array.isArray(data.stockMovements);
  return hasProducts && hasSales && (hasBackupMeta || hasStockMovements);
}

/**
 * Converte o JSON real para o modelo intermediário do ONÇA PDV novo.
 */
export function toOncasPdvV2Model(data) {
  const unknownFields = new Set();
  const invalid = [];
  const duplicates = { products: [], customers: [], suppliers: [], sales: [] };
  const warnings = [];

  const knownRoot = new Set([
    'products',
    'customers',
    'sales',
    'stockMovements',
    'cash',
    'settings',
    'backupHistory',
    'backupSettings',
    'users',
    'auditLog',
    'startDate',
    'company',
    'internalNotes',
    'receivables',
    'payables',
    'deliveries',
    'returns',
    'quotes',
    'salesGoals',
    'promotions',
    'suppliers',
    'purchases',
    'backup',
    'operatorHistory',
    '_estoque1000feito',
    'financialEntries',
    'stockLocations',
    'stockByLocation',
  ]);
  for (const k of Object.keys(data || {})) {
    if (!knownRoot.has(k)) unknownFields.add(`root.${k}`);
  }

  // --- products ---
  const products = [];
  const seenCodes = new Map();
  const productByLegacy = new Map();
  for (const raw of data.products || []) {
    try {
      const legacyId = String(raw.id);
      const name = String(raw.name || '').trim();
      if (!name) {
        invalid.push({ entity: 'product', reason: 'sem nome', raw });
        continue;
      }
      // SKU sempre único por legacy_id (evita UNIQUE constraint no SQLite novo).
      // O código original vai para barcode quando for EAN/UPC válido e não duplicado.
      const code = raw.code != null ? String(raw.code) : null;
      let barcode = null;
      const sku = `L-${legacyId}`;

      if (code && isJunkCode(code)) {
        warnings.push({ entity: 'product', legacy_id: legacyId, warning: `codigo_invalido:${code}` });
        unknownFields.add('product.code.junk');
      } else if (code && looksLikeBarcode(code)) {
        if (seenCodes.has(code)) {
          duplicates.products.push({
            legacy_id: legacyId,
            reason: 'codigo_duplicado',
            code,
            other_legacy_id: seenCodes.get(code),
          });
          // Não sobrescreve o primeiro: segundo fica sem barcode
          barcode = null;
        } else {
          seenCodes.set(code, legacyId);
          barcode = code;
        }
      } else if (code) {
        // código interno não-EAN: guardado só via sku L-{id}; registra observação
        unknownFields.add('product.code.internal_non_ean');
      }

      const stockQty = Number(raw.stock);
      const stock = Number.isFinite(stockQty) ? Math.trunc(stockQty) : 0;
      const allowNeg = stock < 0 ? 1 : 0;
      if (stock < 0) {
        warnings.push({ entity: 'product', legacy_id: legacyId, warning: `estoque_negativo:${stock}` });
      }

      const knownProdFields = new Set([
        'id',
        'code',
        'name',
        'category',
        'price',
        'cost',
        'stock',
        'min',
        'active',
        '_precoAnterior',
        'createdAt',
        'updatedAt',
        'diverso',
      ]);
      for (const k of Object.keys(raw)) {
        if (!knownProdFields.has(k)) unknownFields.add(`product.${k}`);
      }

      const row = {
        legacy_id: legacyId,
        legacy_source: LEGACY_SOURCE,
        name,
        sku,
        barcode,
        category: String(raw.category || 'Geral'),
        unit: 'UN',
        price_cents: pickMoney(raw.price, 'product.price'),
        cost_cents: pickMoney(raw.cost ?? 0, 'product.cost'),
        stock_qty: stock,
        min_stock_qty: Number.isFinite(Number(raw.min)) ? Math.max(0, Math.trunc(Number(raw.min))) : 0,
        allow_negative_stock: allowNeg,
        active: raw.active === false ? 0 : 1,
        _precoAnterior: raw._precoAnterior,
      };
      products.push(row);
      productByLegacy.set(legacyId, row);
    } catch (err) {
      invalid.push({ entity: 'product', reason: err.message, raw });
    }
  }

  // --- customers ---
  const customers = [];
  for (const raw of data.customers || []) {
    const legacyId = String(raw.id);
    const name = String(raw.name || '').trim();
    if (!name) {
      invalid.push({ entity: 'customer', reason: 'sem nome', raw });
      continue;
    }
    // Consumidor Final (id 0) — importar como cliente sistema opcional
    const document = cleanDocument(raw.document);
    const phone = cleanText(raw.phone);
    customers.push({
      legacy_id: legacyId,
      legacy_source: LEGACY_SOURCE,
      name,
      document,
      phone,
      whatsapp: phone,
      address: null,
      city: null,
      state: null,
      active: raw.active === false ? 0 : 1,
      is_consumidor_final: legacyId === '0' || /^consumidor final$/i.test(name),
    });
    for (const k of Object.keys(raw)) {
      if (!['id', 'name', 'phone', 'document', 'active'].includes(k)) unknownFields.add(`customer.${k}`);
    }
  }

  // --- sales ---
  const sales = [];
  for (const raw of data.sales || []) {
    try {
      const legacyId = String(raw.id);
      const items = Array.isArray(raw.items) ? raw.items : [];
      const mappedItems = items.map((it) => {
        const misc = isMiscItem(it);
        const qty = Math.max(1, Math.trunc(Number(it.qty) || 1));
        const unit = pickMoney(it.price, 'sale_item.price');
        return {
          name: String(it.name || 'Item'),
          quantity: qty,
          unit_price_cents: unit,
          product_legacy_id: misc ? null : it.id != null ? String(it.id) : null,
          is_misc: misc,
          barcode: !misc && looksLikeBarcode(it.code) ? String(it.code) : null,
        };
      });

      const payment = mapPayment(raw.payment);
      sales.push({
        legacy_id: legacyId,
        legacy_source: LEGACY_SOURCE,
        created_at: raw.date || null,
        subtotal_cents: pickMoney(raw.subtotal ?? raw.total, 'sale.subtotal'),
        discount_cents: pickMoney(raw.discount ?? 0, 'sale.discount'),
        total_cents: pickMoney(raw.total, 'sale.total'),
        payment_method: payment,
        payment_raw: raw.payment,
        received_cents: pickMoney(raw.received ?? raw.total, 'sale.received'),
        change_cents: pickMoney(raw.change ?? 0, 'sale.change'),
        customer_legacy_id:
          raw.customer && raw.customer.id != null ? String(raw.customer.id) : null,
        customer_name: raw.customer?.name || null,
        operator_name: raw.operator?.name || null,
        notes: raw.profit != null ? `profit_legado=${raw.profit}` : null,
        items: mappedItems,
        apply_stock: false, // estoque já vem do snapshot products[]
      });

      const knownSale = new Set([
        'id',
        'date',
        'items',
        'subtotal',
        'discount',
        'discountType',
        'discountInput',
        'total',
        'payment',
        'received',
        'change',
        'customer',
        'operator',
        'profit',
        '_alertaOk',
      ]);
      for (const k of Object.keys(raw)) {
        if (!knownSale.has(k)) unknownFields.add(`sale.${k}`);
      }
    } catch (err) {
      invalid.push({ entity: 'sale', reason: err.message, raw: { id: raw?.id } });
    }
  }

  // --- stock movements (histórico; não reaplica delta no estoque) ---
  const stockMovements = [];
  for (const raw of data.stockMovements || []) {
    stockMovements.push({
      legacy_id: String(raw.id),
      legacy_source: LEGACY_SOURCE,
      product_legacy_id: raw.productId != null ? String(raw.productId) : null,
      product_name: raw.productName || null,
      product_code: raw.productCode || null,
      created_at: raw.date || null,
      before: raw.before,
      after: raw.after,
      quantity_delta: Number(raw.difference) || 0,
      type_raw: raw.type,
      reason: raw.reason || null,
      reference: raw.reference != null ? String(raw.reference) : null,
      apply_to_stock: false,
    });
  }

  // --- cash history → sessões fechadas ---
  const cashSessions = [];
  const cash = data.cash || {};
  for (const h of cash.history || []) {
    cashSessions.push({
      legacy_id: String(h.id),
      operator_name: h.operator || 'Operador',
      opening_amount_cents: pickMoney(h.opening ?? 0, 'cash.opening'),
      opened_at: h.openedAt || null,
      closed_at: h.closedAt || null,
      sales_total_cents: pickMoney(h.salesTotal ?? 0, 'cash.salesTotal'),
      expected_amount_cents: pickMoney(h.expected ?? 0, 'cash.expected'),
      counted_amount_cents: pickMoney(h.counted ?? 0, 'cash.counted'),
      difference_cents: pickMoney(h.difference ?? 0, 'cash.difference'),
      close_notes: h.note || null,
      status: 'closed',
      by_payment: h.byPayment || null,
    });
  }

  // --- settings / company ---
  const company = data.company || {};
  const settings = data.settings || {};
  const receipt = settings.receipt || {};
  const settingsMapped = {
    store_name: company.legalName || receipt.businessName || settings.tradeName || 'ONÇA PDV',
    store_trade_name: company.tradeName || settings.tradeName || 'ONÇA PRODUTOS DE LIMPEZA',
    store_document: cleanDocument(company.cnpj || settings.document || receipt.document) || '',
    store_address:
      company.address ||
      receipt.address ||
      settings.address ||
      '',
    store_phone: cleanText(settings.phone || receipt.phone) || '',
    receipt_message: receipt.footer || 'Obrigado pela preferência!',
    ui_theme: settings.theme || 'padrao',
  };

  // --- empty collections preserved in report ---
  const emptyCollections = {};
  for (const k of [
    'suppliers',
    'purchases',
    'receivables',
    'payables',
    'deliveries',
    'returns',
    'quotes',
    'promotions',
    'salesGoals',
    'financialEntries',
    'internalNotes',
    'operatorHistory',
  ]) {
    emptyCollections[k] = Array.isArray(data[k]) ? data[k].length : 0;
  }

  // --- users (metadados; senha/PIN legado NÃO é reutilizada) ---
  const usersMeta = (data.users || []).map((u) => ({
    legacy_id: String(u.id),
    name: u.name,
    login: u.login,
    role_raw: u.role,
    active: u.active !== false,
    note: 'pinHash legado NÃO importado como senha',
  }));

  return {
    legacy_source: LEGACY_SOURCE,
    adapter: ADAPTER_ID,
    adapter_version: ADAPTER_VERSION,
    backup_meta: data.backup || null,
    products,
    customers,
    suppliers: [],
    sales,
    purchases: [],
    credit: [],
    returns: [],
    deliveries: [],
    stock_movements: stockMovements,
    cash_sessions: cashSessions,
    settings: settingsMapped,
    users_meta: usersMeta,
    empty_collections: emptyCollections,
    invalid,
    duplicates,
    warnings,
    unknown_fields: [...unknownFields].sort(),
    mapper_note: 'Adaptador específico Oncas PDV v2 — mapeamento real.',
  };
}

export function buildOncasPreview(model, analysisExtras = {}) {
  return {
    adapter: model.adapter,
    adapter_version: model.adapter_version,
    produtos_encontrados: model.products.length,
    clientes_encontrados: model.customers.length,
    fornecedores_encontrados: model.suppliers.length,
    vendas_encontradas: model.sales.length,
    itens_venda: model.sales.reduce((a, s) => a + (s.items?.length || 0), 0),
    movimentacoes_estoque: model.stock_movements.length,
    sessoes_caixa: model.cash_sessions.length,
    registros_crediario: model.credit.length,
    compras_encontradas: model.purchases.length,
    entregas_encontradas: model.deliveries.length,
    registros_invalidos: model.invalid.length,
    possiveis_duplicidades: model.duplicates.products.length + model.duplicates.customers.length,
    campos_desconhecidos: model.unknown_fields.length,
    unknown_fields_sample: model.unknown_fields.slice(0, 80),
    warnings_count: model.warnings.length,
    empty_collections: model.empty_collections,
    duplicates_sample: {
      products: model.duplicates.products.slice(0, 20),
    },
    ...analysisExtras,
  };
}
