import { useEffect, useMemo, useState } from 'react';
import {
  createStockMovement,
  fetchProducts,
  setStockBalanceApi,
  type Product,
} from '../../api/client';

export type AdjustMode = 'entry' | 'exit' | 'set_balance';

export const STOCK_REASON_OPTIONS = [
  'Correção de estoque',
  'Contagem física',
  'Entrada manual',
  'Perda / avaria',
  'Correção de cadastro',
  'Outro',
] as const;

type Props = {
  /** Quando informado, o produto fica fixo (ex.: edição de produto). */
  product?: Product | null;
  /** Pré-seleciona um product_id na lista. */
  initialProductId?: number | null;
  /** Modo inicial: entry | exit | set_balance */
  initialMode?: AdjustMode;
  onClose: () => void;
  onDone: (result: {
    product_id: number;
    stock_before: number;
    stock_after: number;
    mode: AdjustMode;
  }) => void;
  onError?: (message: string) => void;
};

export default function StockAdjustModal({
  product: lockedProduct = null,
  initialProductId = null,
  initialMode = 'entry',
  onClose,
  onDone,
  onError,
}: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState(
    lockedProduct ? String(lockedProduct.id) : initialProductId ? String(initialProductId) : ''
  );
  const [mode, setMode] = useState<AdjustMode>(initialMode);
  const [quantity, setQuantity] = useState('1');
  const [newQty, setNewQty] = useState('');
  const [reasonChoice, setReasonChoice] = useState<string>(STOCK_REASON_OPTIONS[0]);
  const [reasonOther, setReasonOther] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [liveProduct, setLiveProduct] = useState<Product | null>(lockedProduct);

  useEffect(() => {
    if (lockedProduct) {
      setLiveProduct(lockedProduct);
      setProductId(String(lockedProduct.id));
      return;
    }
    void fetchProducts({ include_inactive: false })
      .then(setProducts)
      .catch((e) => setLocalError(e instanceof Error ? e.message : 'Erro ao carregar produtos'));
  }, [lockedProduct]);

  useEffect(() => {
    if (lockedProduct) return;
    const p = products.find((x) => String(x.id) === productId) || null;
    setLiveProduct(p);
  }, [products, productId, lockedProduct]);

  const selected = liveProduct;

  const preview = useMemo(() => {
    if (!selected) return null;
    if (mode === 'set_balance') {
      const n = Number(newQty);
      if (!Number.isInteger(n) || n < 0) return null;
      return {
        newStock: n,
        delta: n - selected.stock_qty,
      };
    }
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) return null;
    const newStock = mode === 'entry' ? selected.stock_qty + qty : selected.stock_qty - qty;
    return {
      newStock,
      delta: mode === 'entry' ? qty : -qty,
    };
  }, [selected, mode, quantity, newQty]);

  function resolveReason(): string | null {
    if (reasonChoice === 'Outro') {
      const t = reasonOther.trim();
      return t || null;
    }
    return reasonChoice;
  }

  async function submit() {
    setLocalError(null);
    if (!selected) {
      setLocalError('Selecione o produto.');
      return;
    }
    const reason = resolveReason();
    if (!reason) {
      setLocalError('Informe o motivo do ajuste.');
      return;
    }
    if (preview == null) {
      setLocalError(mode === 'set_balance' ? 'Quantidade correta inválida.' : 'Quantidade inválida.');
      return;
    }
    if (mode === 'exit' && preview.newStock < 0) {
      setLocalError('Saída deixaria o estoque negativo.');
      return;
    }

    setBusy(true);
    try {
      let stock_before = selected.stock_qty;
      let stock_after = preview.newStock;
      if (mode === 'set_balance') {
        const res = await setStockBalanceApi({
          product_id: selected.id,
          new_qty: preview.newStock,
          reason,
          note: note.trim() || undefined,
        });
        stock_before = res.stock_before;
        stock_after = res.stock_after;
      } else {
        const res = await createStockMovement({
          product_id: selected.id,
          movement_type: mode,
          quantity: Number(quantity),
          reason,
          note: note.trim() || undefined,
        });
        stock_before = res.stock_before ?? selected.stock_qty;
        stock_after = res.stock_after;
      }
      onDone({
        product_id: selected.id,
        stock_before,
        stock_after,
        mode,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro no ajuste de estoque';
      setLocalError(msg);
      onError?.(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Ajuste de estoque">
      <form
        className="modal modal-wide"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h3>Ajuste de estoque</h3>
        <p className="muted-line">
          Estoque atual e estoque mínimo são informações diferentes. Este ajuste altera o saldo
          atual e registra movimentação.
        </p>

        {localError && <div className="alert alert-error">{localError}</div>}

        <div className="modal-fields">
          {lockedProduct ? (
            <div className="stock-adjust-product">
              <div>
                <strong>{lockedProduct.name}</strong>
              </div>
              <div className="muted-line">
                Código: {lockedProduct.sku || '—'} · Barras: {lockedProduct.barcode || '—'}
              </div>
              <div className="stock-current-line">
                Estoque atual: <strong>{lockedProduct.stock_qty} {lockedProduct.unit || 'UN'}</strong>
              </div>
            </div>
          ) : (
            <label>
              Produto
              <select
                className="field-input"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
              >
                <option value="">Selecione…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (atual: {p.stock_qty})
                  </option>
                ))}
              </select>
            </label>
          )}

          {selected && !lockedProduct && (
            <div className="stock-current-line">
              Código: {selected.sku || '—'} · Barras: {selected.barcode || '—'} · Estoque atual:{' '}
              <strong>
                {selected.stock_qty} {selected.unit || 'UN'}
              </strong>
            </div>
          )}

          <div className="stock-mode-row" role="group" aria-label="Tipo de ajuste">
            <button
              type="button"
              className={mode === 'entry' ? 'btn btn-primary' : 'btn btn-ghost'}
              onClick={() => setMode('entry')}
            >
              Entrada
            </button>
            <button
              type="button"
              className={mode === 'exit' ? 'btn btn-primary' : 'btn btn-ghost'}
              onClick={() => setMode('exit')}
            >
              Saída
            </button>
            <button
              type="button"
              className={mode === 'set_balance' ? 'btn btn-primary' : 'btn btn-ghost'}
              onClick={() => setMode('set_balance')}
            >
              Definir quantidade
            </button>
          </div>

          {mode === 'set_balance' ? (
            <label>
              Quantidade correta
              <input
                className="field-input"
                value={newQty}
                onChange={(e) => setNewQty(e.target.value)}
                inputMode="numeric"
                autoFocus
              />
            </label>
          ) : (
            <label>
              Quantidade
              <input
                className="field-input"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                inputMode="numeric"
                autoFocus
              />
            </label>
          )}

          {preview && selected && (
            <div className="stock-preview-box">
              {mode === 'set_balance' && (
                <div>
                  Diferença:{' '}
                  <strong>
                    {preview.delta > 0 ? `+${preview.delta}` : String(preview.delta)}
                  </strong>
                </div>
              )}
              <div>
                Novo estoque: <strong>{preview.newStock}</strong>
              </div>
            </div>
          )}

          <label>
            Motivo *
            <select
              className="field-input"
              value={reasonChoice}
              onChange={(e) => setReasonChoice(e.target.value)}
            >
              {STOCK_REASON_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          {reasonChoice === 'Outro' && (
            <label>
              Descreva o motivo *
              <input
                className="field-input"
                value={reasonOther}
                onChange={(e) => setReasonOther(e.target.value)}
              />
            </label>
          )}

          <label>
            Observação
            <input
              className="field-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Opcional"
            />
          </label>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Salvando…' : 'Confirmar ajuste'}
          </button>
        </div>
      </form>
    </div>
  );
}
