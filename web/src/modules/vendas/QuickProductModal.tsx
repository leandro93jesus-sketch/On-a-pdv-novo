import { useState, type FormEvent } from 'react';
import { createProduct, fetchProducts, type Product } from '../../api/client';

type Props = {
  barcode: string;
  onCancel: () => void;
  onCreated: (product: Product) => void;
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
 * Cadastro rápido durante a venda quando o código de barras não existe.
 * Reutiliza a API/rotina de produtos existente (createProduct + estoque inicial).
 */
export default function QuickProductModal({
  barcode,
  onCancel,
  onCreated,
  onUseExisting,
}: Props) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [minStock, setMinStock] = useState('');
  const [category, setCategory] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<Product | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function resolveExisting(): Promise<Product | null> {
    const byBarcode = await fetchProducts({ barcode });
    if (byBarcode[0]) return byBarcode[0];
    return null;
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

    const stockQty = parseOptionalInt(stock);
    if (stockQty !== null && Number.isNaN(stockQty)) {
      setError('Estoque inicial inválido.');
      return;
    }
    const minStockQty = parseOptionalInt(minStock);
    if (minStockQty !== null && Number.isNaN(minStockQty)) {
      setError('Estoque mínimo inválido.');
      return;
    }

    setSubmitting(true);
    try {
      const already = await resolveExisting();
      if (already) {
        setExisting(already);
        setError('ESTE PRODUTO JÁ ESTÁ CADASTRADO.');
        return;
      }

      const product = await createProduct({
        name: name.trim(),
        barcode,
        price_cents: priceCents,
        stock_qty: stockQty ?? 0,
        min_stock_qty: minStockQty ?? 0,
        category: category.trim() || undefined,
        confirm_similar_name: true,
      });
      onCreated(product);
    } catch (err) {
      const e2 = err as Error & { code?: string };
      if (e2.code === 'DUPLICATE_BARCODE' || e2.code === 'DUPLICATE_SKU') {
        try {
          const found = await resolveExisting();
          if (found) {
            setExisting(found);
            setError('ESTE PRODUTO JÁ ESTÁ CADASTRADO.');
            return;
          }
        } catch {
          // fall through
        }
        setError('ESTE PRODUTO JÁ ESTÁ CADASTRADO.');
        return;
      }
      setError(e2.message || 'Erro ao cadastrar produto');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Cadastro rápido de produto"
    >
      <form className="modal modal-wide" onSubmit={(e) => void submit(e)}>
        <h3>CADASTRO RÁPIDO DE PRODUTO</h3>
        <p>Produto não cadastrado. Preencha para adicionar à venda atual.</p>
        <div className="modal-fields">
          <label>
            Código de barras
            <input value={barcode} readOnly />
          </label>
          <label>
            Nome do produto *
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
          <label>
            Estoque mínimo
            <input
              value={minStock}
              onChange={(e) => setMinStock(e.target.value)}
              inputMode="numeric"
              placeholder="0"
            />
          </label>
          <label>
            Categoria
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Opcional"
            />
          </label>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={submitting}>
            CANCELAR
          </button>
          {existing ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onUseExisting(existing)}
            >
              USAR PRODUTO EXISTENTE
            </button>
          ) : (
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Cadastrando…' : 'CADASTRAR E ADICIONAR À VENDA'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
