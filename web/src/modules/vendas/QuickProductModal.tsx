import { useState, type FormEvent } from 'react';
import { createProduct, fetchProducts, type Product } from '../../api/client';

type Props = {
  barcode: string;
  onCancel: () => void;
  onCreated: (product: Product) => void;
  onCreatedOnly?: (product: Product) => void;
  onUseExisting: (product: Product) => void;
};

function parseBRL(input: string): number | null {
  const normalized = input.replace(/\./g, '').replace(',', '.').trim();
  if (!normalized) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

function parseOptionalInt(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(',', '.'));
  if (!Number.isInteger(n) || n < 0) return NaN as unknown as number;
  return n;
}

/**
 * Cadastro rápido enxuto: só o essencial; extras atrás de "Mais informações".
 */
export default function QuickProductModal({
  barcode,
  onCancel,
  onCreated,
  onCreatedOnly,
  onUseExisting,
}: Props) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [cost, setCost] = useState('');
  const [minStock, setMinStock] = useState('');
  const [category, setCategory] = useState('');
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<Product | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<'add' | 'only'>('add');

  async function resolveExisting(): Promise<Product | null> {
    const byBarcode = await fetchProducts({ barcode });
    return byBarcode[0] || null;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setExisting(null);

    if (!name.trim()) {
      setError('Nome do produto é obrigatório.');
      return;
    }
    const priceCents = parseBRL(price);
    if (priceCents == null) {
      setError('Preço de venda é obrigatório.');
      return;
    }
    const costCents = more && cost.trim() ? parseBRL(cost) : 0;
    if (costCents == null) {
      setError('Preço de custo inválido.');
      return;
    }
    const stockQty = parseOptionalInt(stock);
    if (stockQty !== null && Number.isNaN(stockQty)) {
      setError('Estoque inicial inválido.');
      return;
    }
    const minStockQty = more ? parseOptionalInt(minStock) : 0;
    if (minStockQty !== null && Number.isNaN(minStockQty)) {
      setError('Estoque mínimo inválido.');
      return;
    }

    setSubmitting(true);
    try {
      const already = await resolveExisting();
      if (already) {
        setExisting(already);
        setError('Este produto já está cadastrado.');
        return;
      }

      const product = await createProduct({
        name: name.trim(),
        barcode,
        price_cents: priceCents,
        cost_cents: costCents ?? 0,
        stock_qty: stockQty ?? 0,
        min_stock_qty: minStockQty ?? 0,
        category: more && category.trim() ? category.trim() : undefined,
        confirm_similar_name: true,
      });
      if (mode === 'only' && onCreatedOnly) onCreatedOnly(product);
      else onCreated(product);
    } catch (err) {
      const e2 = err as Error & { code?: string };
      if (e2.code === 'DUPLICATE_BARCODE' || e2.code === 'DUPLICATE_SKU') {
        try {
          const found = await resolveExisting();
          if (found) {
            setExisting(found);
            setError('Este produto já está cadastrado.');
            return;
          }
        } catch {
          /* ignore */
        }
        setError('Este produto já está cadastrado.');
        return;
      }
      setError(e2.message || 'Erro ao cadastrar produto');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Produto não cadastrado">
      <form className="modal" onSubmit={(e) => void submit(e)}>
        <h3>PRODUTO NÃO CADASTRADO</h3>
        <p className="muted-line">
          Código lido: <strong>{barcode}</strong> — preencha o essencial e continue a venda.
        </p>
        <div className="modal-fields">
          <label>
            Código de barras
            <input value={barcode} readOnly />
          </label>
          <label>
            Nome *
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome do produto"
            />
          </label>
          <label>
            Preço de venda (R$) *
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
            />
          </label>
          <label>
            Estoque inicial
            <input
              value={stock}
              onChange={(e) => setStock(e.target.value)}
              inputMode="numeric"
              placeholder="0"
            />
          </label>
        </div>

        <button
          type="button"
          className="btn btn-ghost"
          style={{ marginTop: 8 }}
          onClick={() => setMore((v) => !v)}
        >
          {more ? 'Ocultar informações' : 'Mais informações'}
        </button>

        {more && (
          <div className="modal-fields" style={{ marginTop: 8 }}>
            <label>
              Categoria
              <input value={category} onChange={(e) => setCategory(e.target.value)} />
            </label>
            <label>
              Preço de custo (R$)
              <input
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                inputMode="decimal"
                placeholder="0,00"
              />
            </label>
            <label>
              Estoque mínimo
              <input
                value={minStock}
                onChange={(e) => setMinStock(e.target.value)}
                inputMode="numeric"
                placeholder="0"
              />
            </label>
          </div>
        )}

        {error && <div className="alert alert-error">{error}</div>}
        <div className="modal-actions" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={submitting}>
            Cancelar
          </button>
          {existing ? (
            <button type="button" className="btn btn-primary" onClick={() => onUseExisting(existing)}>
              Usar existente
            </button>
          ) : (
            <>
              {onCreatedOnly ? (
                <button
                  type="submit"
                  className="btn btn-ghost"
                  disabled={submitting}
                  onClick={() => setMode('only')}
                >
                  Cadastrar
                </button>
              ) : null}
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting}
                onClick={() => setMode('add')}
              >
                {submitting ? 'Salvando…' : 'Cadastrar e adicionar'}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
