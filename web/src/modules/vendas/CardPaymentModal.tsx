import { useState } from 'react';
import { formatBRL } from '../../api/client';

export type CardType = 'CREDIT' | 'DEBIT';

type Props = {
  totalCents: number;
  title?: string;
  initialType?: CardType | null;
  confirmLabel?: string;
  onBack: () => void;
  onConfirm: (cardType: CardType) => void;
};

/**
 * Modal único de seleção Crédito/Débito para Vendas, Misto e Entregas.
 */
export default function CardPaymentModal({
  totalCents,
  title = 'PAGAMENTO COM CARTÃO',
  initialType = null,
  confirmLabel = 'CONFIRMAR PAGAMENTO',
  onBack,
  onConfirm,
}: Props) {
  const [cardType, setCardType] = useState<CardType | null>(initialType);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!cardType) {
      setError('SELECIONE CRÉDITO OU DÉBITO.');
      return;
    }
    setError(null);
    onConfirm(cardType);
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="card-payment-modal"
    >
      <div className="modal">
        <h2 style={{ marginTop: 0 }}>{title}</h2>
        <div className="kv-list" style={{ marginBottom: 16 }}>
          <div>
            <span>Valor</span>
            <strong data-testid="card-payment-amount">{formatBRL(totalCents)}</strong>
          </div>
        </div>
        <p style={{ margin: '0 0 10px', fontWeight: 650 }}>Escolha o tipo:</p>
        <div className="payment-options" style={{ gap: 10 }}>
          <button
            type="button"
            data-testid="card-type-credit"
            className={cardType === 'CREDIT' ? 'pay-btn active' : 'pay-btn'}
            style={{ minWidth: 140, minHeight: 48, fontSize: 16 }}
            onClick={() => {
              setCardType('CREDIT');
              setError(null);
            }}
          >
            CRÉDITO
          </button>
          <button
            type="button"
            data-testid="card-type-debit"
            className={cardType === 'DEBIT' ? 'pay-btn active' : 'pay-btn'}
            style={{ minWidth: 140, minHeight: 48, fontSize: 16 }}
            onClick={() => {
              setCardType('DEBIT');
              setError(null);
            }}
          >
            DÉBITO
          </button>
        </div>
        {error ? (
          <div className="alert alert-error" style={{ marginTop: 14 }} data-testid="card-type-error">
            {error}
          </div>
        ) : null}
        <div className="modal-actions" style={{ marginTop: 18 }}>
          <button type="button" className="btn btn-ghost" data-testid="card-payment-back" onClick={onBack}>
            VOLTAR
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="card-payment-confirm"
            onClick={submit}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
