/**
 * Mapeamento genérico/heurístico para fixtures de teste e estruturas próximas.
 * NÃO é o adaptador definitivo do backup real do usuário.
 */
import { parseLegacyMoneyToCents } from '../../utils/moneyLegacy.js';

const LEGACY_SOURCE = 'json_legado_generico';

function pick(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null && obj[k] !== '') return obj[k];
  }
  return null;
}

function asArray(data, ...keys) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  for (const k of keys) {
    if (Array.isArray(data[k])) return data[k];
  }
  return [];
}

export function toIntermediateModel(data, analysis) {
  const unknownFields = new Set(analysis.unknown_root_keys || []);
  const products = [];
  const customers = [];
  const suppliers = [];
  const sales = [];
  const invalid = [];
  const duplicates = { products: [], customers: [], suppliers: [], sales: [] };

  const productRows = asArray(data, 'produtos', 'products', 'itens', 'catalogo');
  const seenProd = new Set();
  for (const raw of productRows) {
    try {
      const name = pick(raw, ['nome', 'name', 'descricao', 'description']);
      if (!name) {
        invalid.push({ entity: 'product', reason: 'sem nome', raw });
        continue;
      }
      const barcode = pick(raw, ['codigoBarras', 'codigo_barras', 'barcode', 'ean']);
      const sku = pick(raw, ['codigo', 'sku', 'codigoInterno', 'codigo_interno', 'id']);
      const legacyId = String(pick(raw, ['id', 'legacy_id', '_id']) ?? sku ?? name);
      const dupKey = `${barcode || ''}|${sku || ''}|${name}`.toLowerCase();
      if (seenProd.has(dupKey)) duplicates.products.push({ legacyId, name });
      seenProd.add(dupKey);

      const price = parseLegacyMoneyToCents(pick(raw, ['preco', 'precoVenda', 'price', 'valor']) ?? 0, {
        field: 'preco',
      });
      const cost = parseLegacyMoneyToCents(pick(raw, ['custo', 'precoCusto', 'cost']) ?? 0, {
        field: 'custo',
      });
      products.push({
        legacy_id: legacyId,
        legacy_source: LEGACY_SOURCE,
        name: String(name),
        sku: sku != null ? String(sku) : null,
        barcode: barcode != null ? String(barcode) : null,
        category: String(pick(raw, ['categoria', 'category']) || 'Geral'),
        unit: String(pick(raw, ['unidade', 'unit']) || 'UN'),
        price_cents: price || 0,
        cost_cents: cost || 0,
        stock_qty: Number(pick(raw, ['estoque', 'stock', 'quantidade', 'qty']) || 0),
        min_stock_qty: Number(pick(raw, ['estoqueMinimo', 'min_stock', 'estoque_minimo']) || 0),
        _raw_keys: Object.keys(raw || {}),
      });
      for (const k of Object.keys(raw || {})) {
        if (
          ![
            'nome',
            'name',
            'descricao',
            'codigoBarras',
            'barcode',
            'ean',
            'codigo',
            'sku',
            'id',
            'preco',
            'precoVenda',
            'price',
            'valor',
            'custo',
            'precoCusto',
            'cost',
            'estoque',
            'stock',
            'quantidade',
            'categoria',
            'category',
            'unidade',
            'unit',
            'estoqueMinimo',
            'min_stock',
          ].includes(k)
        ) {
          unknownFields.add(`product.${k}`);
        }
      }
    } catch (err) {
      invalid.push({ entity: 'product', reason: err.message, raw });
    }
  }

  const customerRows = asArray(data, 'clientes', 'customers');
  const seenCust = new Set();
  for (const raw of customerRows) {
    const name = pick(raw, ['nome', 'name']);
    if (!name) {
      invalid.push({ entity: 'customer', reason: 'sem nome', raw });
      continue;
    }
    const document = pick(raw, ['cpf', 'cnpj', 'documento', 'document']);
    const phone = pick(raw, ['telefone', 'phone', 'fone']);
    const legacyId = String(pick(raw, ['id', 'legacy_id']) ?? document ?? name);
    const dupKey = `${document || ''}|${phone || ''}|${name}`.toLowerCase();
    if (seenCust.has(dupKey)) duplicates.customers.push({ legacyId, name });
    seenCust.add(dupKey);
    customers.push({
      legacy_id: legacyId,
      legacy_source: LEGACY_SOURCE,
      name: String(name),
      document: document != null ? String(document).replace(/\D/g, '') : null,
      phone: phone != null ? String(phone) : null,
      whatsapp: pick(raw, ['whatsapp', 'celular']) != null ? String(pick(raw, ['whatsapp', 'celular'])) : null,
      address: pick(raw, ['endereco', 'address']) != null ? String(pick(raw, ['endereco', 'address'])) : null,
      city: pick(raw, ['cidade', 'city']) != null ? String(pick(raw, ['cidade', 'city'])) : null,
      state: pick(raw, ['uf', 'estado', 'state']) != null ? String(pick(raw, ['uf', 'estado', 'state'])) : null,
    });
  }

  const supplierRows = asArray(data, 'fornecedores', 'suppliers');
  const seenSup = new Set();
  for (const raw of supplierRows) {
    const name = pick(raw, ['nome', 'name', 'razaoSocial', 'razao_social']);
    if (!name) {
      invalid.push({ entity: 'supplier', reason: 'sem nome', raw });
      continue;
    }
    const document = pick(raw, ['cnpj', 'cpf', 'documento', 'document']);
    const legacyId = String(pick(raw, ['id', 'legacy_id']) ?? document ?? name);
    const dupKey = `${document || ''}|${name}`.toLowerCase();
    if (seenSup.has(dupKey)) duplicates.suppliers.push({ legacyId, name });
    seenSup.add(dupKey);
    suppliers.push({
      legacy_id: legacyId,
      legacy_source: LEGACY_SOURCE,
      name: String(name),
      trade_name: pick(raw, ['fantasia', 'trade_name']) != null ? String(pick(raw, ['fantasia', 'trade_name'])) : null,
      document: document != null ? String(document).replace(/\D/g, '') : null,
      phone: pick(raw, ['telefone', 'phone']) != null ? String(pick(raw, ['telefone', 'phone'])) : null,
      city: pick(raw, ['cidade', 'city']) != null ? String(pick(raw, ['cidade', 'city'])) : null,
      state: pick(raw, ['uf', 'estado', 'state']) != null ? String(pick(raw, ['uf', 'estado', 'state'])) : null,
    });
  }

  const saleRows = asArray(data, 'vendas', 'sales', 'pedidos');
  const seenSale = new Set();
  for (const raw of saleRows) {
    try {
      const legacyId = String(pick(raw, ['id', 'numero', 'sale_number', 'legacy_id']) ?? '');
      const total = parseLegacyMoneyToCents(pick(raw, ['total', 'valorTotal', 'total_cents']) ?? 0, {
        field: 'total',
      });
      const created = pick(raw, ['data', 'created_at', 'date', 'hora']);
      const dupKey = `${legacyId}|${created}|${total}`;
      if (legacyId && seenSale.has(dupKey)) duplicates.sales.push({ legacyId });
      if (legacyId) seenSale.add(dupKey);

      const itemsRaw = asArray(raw, 'itens', 'items', 'produtos');
      const items = itemsRaw.map((it) => ({
        name: String(pick(it, ['nome', 'name', 'produto']) || 'Item'),
        quantity: Number(pick(it, ['quantidade', 'qty', 'quantity']) || 1),
        unit_price_cents: parseLegacyMoneyToCents(pick(it, ['preco', 'unit_price', 'valor']) ?? 0, {
          field: 'item.preco',
        }),
        product_legacy_id: pick(it, ['produtoId', 'product_id', 'id_produto']),
      }));

      sales.push({
        legacy_id: legacyId || `sale-${sales.length + 1}`,
        legacy_source: LEGACY_SOURCE,
        created_at: created ? String(created) : null,
        total_cents: total || 0,
        discount_cents: parseLegacyMoneyToCents(pick(raw, ['desconto', 'discount']) ?? 0, { field: 'desconto' }) || 0,
        customer_legacy_id: pick(raw, ['clienteId', 'customer_id', 'id_cliente']),
        payment_method: String(pick(raw, ['pagamento', 'formaPagamento', 'payment_method']) || 'dinheiro')
          .toLowerCase()
          .replace('cartão', 'cartao')
          .replace('cartao', 'cartao'),
        items,
      });
    } catch (err) {
      invalid.push({ entity: 'sale', reason: err.message, raw });
    }
  }

  return {
    legacy_source: LEGACY_SOURCE,
    products,
    customers,
    suppliers,
    sales,
    purchases: [],
    credit: [],
    returns: [],
    deliveries: [],
    invalid,
    duplicates,
    unknown_fields: [...unknownFields].sort(),
    mapper: 'generic_v1',
    mapper_note: 'IMPORTADOR PREPARADO — AGUARDANDO BACKUP JSON REAL PARA MAPEAMENTO FINAL.',
  };
}

export function buildPreview(model, analysis) {
  return {
    produtos_encontrados: model.products.length,
    clientes_encontrados: model.customers.length,
    fornecedores_encontrados: model.suppliers.length,
    vendas_encontradas: model.sales.length,
    compras_encontradas: model.purchases.length,
    registros_crediario: model.credit.length,
    entregas_encontradas: model.deliveries.length,
    registros_invalidos: model.invalid.length,
    possiveis_duplicidades:
      model.duplicates.products.length +
      model.duplicates.customers.length +
      model.duplicates.suppliers.length +
      model.duplicates.sales.length,
    campos_desconhecidos: model.unknown_fields.length,
    unknown_fields_sample: model.unknown_fields.slice(0, 50),
    duplicates_sample: model.duplicates,
    analysis_summary: {
      root_type: analysis.root_type,
      detected_collections: analysis.detected_collections,
      sha256: analysis.sha256,
      filename: analysis.filename,
    },
    mapper: model.mapper,
    mapper_note: model.mapper_note,
  };
}
