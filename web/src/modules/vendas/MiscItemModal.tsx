import { useState, type FormEvent } from 'react';

interface Props {
  onCancel: () => void;
  onConfirm: (name: string, priceCents: number) => void;
}

export default function MiscItemModal({ onCancel, onConfirm }: Props) {
  const [name, setName] = useState('Item Diversos');
  const [price, setPrice] = useState('0,00');
  const [error, setError] = useState<string | null>(null);

  function parseBRL(input: string): number | null {
    const normalized = input.replace(/\./g, '').replace(',', '.').trim();
    const value = Number(normalized);
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.round(value * 100);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseBRL(price);
    if (cents === null) {
      setError('Informe um preço válido.');
      return;
    }
    if (!name.trim()) {
      setError('Informe a descrição do item.');
      return;
    }
    onConfirm(name.trim(), cents);
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Item Diversos">
      <form className="modal" onSubmit={submit}>
        <h3>Item Diversos</h3>
        <p>Lança um item avulso sem baixa de estoque.</p>
        <div className="modal-fields">
          <label>
            Descrição
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Taxa de entrega"
            />
          </label>
          <label>
            Preço unitário (R$)
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
            />
          </label>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary">
            Adicionar
          </button>
        </div>
      </form>
    </div>
  );
}
