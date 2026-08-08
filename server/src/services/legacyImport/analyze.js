/** Análise estrutural do JSON legado — não modifica o arquivo. */

const KNOWN_ALIASES = {
  products: ['produtos', 'products', 'itens', 'items', 'catalogo', 'estoque'],
  customers: ['clientes', 'customers', 'pessoas'],
  suppliers: ['fornecedores', 'suppliers'],
  sales: ['vendas', 'sales', 'pedidos'],
  sale_items: ['itens_venda', 'sale_items', 'vendaItens', 'itensVenda'],
  payments: ['pagamentos', 'payments', 'formasPagamento'],
  purchases: ['compras', 'purchases', 'entradas'],
  credit: ['crediario', 'credit', 'contasReceber', 'contas_receber'],
  installments: ['parcelas', 'installments'],
  returns: ['devolucoes', 'devoluções', 'returns', 'trocas'],
  deliveries: ['entregas', 'deliveries', 'delivery'],
  stock_movements: ['movimentacoes', 'movimentações', 'stock_movements', 'estoqueMov'],
  settings: ['configuracoes', 'configurações', 'settings', 'config'],
  categories: ['categorias', 'categories'],
};

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function sampleValues(arr, limit = 3) {
  return arr.slice(0, limit).map((v) => {
    if (v && typeof v === 'object') return Object.keys(v).slice(0, 12);
    return v;
  });
}

export function detectRootCollections(data) {
  const found = {};
  const unknown = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { found, unknown, rootType: typeOf(data) };
  }
  for (const key of Object.keys(data)) {
    let matched = null;
    for (const [canonical, aliases] of Object.entries(KNOWN_ALIASES)) {
      if (aliases.some((a) => a.toLowerCase() === key.toLowerCase())) {
        matched = canonical;
        break;
      }
    }
    if (matched) {
      found[matched] = { key, valueType: typeOf(data[key]), count: Array.isArray(data[key]) ? data[key].length : 1 };
    } else {
      unknown.push(key);
    }
  }
  return { found, unknown, rootType: 'object' };
}

export function analyzeJsonStructure(data, { filename = null, sizeBytes = 0, sha256 = null } = {}) {
  const rootType = typeOf(data);
  const { found, unknown } = detectRootCollections(data);

  const keyStats = {};
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const [k, v] of Object.entries(data)) {
      keyStats[k] = {
        type: typeOf(v),
        length: Array.isArray(v) ? v.length : undefined,
        sample: Array.isArray(v) ? sampleValues(v) : typeof v === 'object' && v ? Object.keys(v).slice(0, 20) : v,
      };
    }
  } else if (Array.isArray(data)) {
    keyStats['(root_array)'] = { type: 'array', length: data.length, sample: sampleValues(data) };
  }

  return {
    filename,
    size_bytes: sizeBytes,
    sha256,
    root_type: rootType,
    detected_collections: found,
    unknown_root_keys: unknown,
    key_stats: keyStats,
    analyzer_version: '1.0.0',
    note: 'Estrutura heurística — mapeamento definitivo depende do backup JSON real.',
  };
}

export { KNOWN_ALIASES };
