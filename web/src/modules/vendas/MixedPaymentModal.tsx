import { useMemo, useState } from 'react';
import { formatBRL } from '../../api/client';

export type MixedAmounts = {
  dinheiro: number;
  pix: number;
  cartao: number;
  crediario: number;
  amount_received_cents: number;
  card_type?: 'CREDIT' | 'DEBIT' | null;
};

type Props = {
  totalCents: number;
  hasCustomer: boolean;
  onCancel: () => void;
  onConfirm: (payload: MixedAmounts) => void;
};

function parseMoney(value: string): number | null {
  const t = value.trim();
  if (!t) return 0;
  if (t.includes('-')) return null;
  const n = Number(t.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

export default function MixedPaymentModal({ totalCents, hasCustomer, onCancel, onConfirm }: Props) {
  const [dinheiro, setDinheiro] = useState('');
  const [pix, setPix] = useState('');
  const [cartao, setCartao] = useState('');
  const [crediario, setCrediario] = useState('');
  const [received, setReceived] = useState('');
  const [cardType, setCardType] = useState<'CREDIT' | 'DEBIT' | ''>('');
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => {
    return {
      dinheiro: parseMoney(dinheiro),
      pix: parseMoney(pix),
      cartao: parseMoney(cartao),
      crediario: parseMoney(crediario),
      received: parseMoney(received),
    };
  }, [dinheiro, pix, cartao, crediario, received]);

  const informed =
    (parsed.dinheiro ?? 0) + (parsed.pix ?? 0) + (parsed.cartao ?? 0) + (parsed.crediario ?? 0);
  const remaining = totalCents - informed;
  const dinheiroPart = parsed.dinheiro ?? 0;
  const receivedCents = parsed.received == null ? dinheiroPart : parsed.received;
  const troco = Math.max(0, receivedCents - dinheiroPart);

  function submit() {
    if (
      parsed.dinheiro == null ||
      parsed.pix == null ||
      parsed.cartao == null ||
      parsed.crediario == null
    ) {
      setError('Valores inválidos.');
      return;
    }
    if (informed !== totalCents) {
      setError(
        informed < totalCents
          ? 'A soma dos pagamentos é menor que o total.'
          : 'A soma dos pagamentos é maior que o total.'
      );
      return;
    }
    if (informed <= 0) {
      setError('Informe ao menos um pagamento.');
      return;
    }
    if (parsed.crediario > 0 && !hasCustomer) {
      setError('Crediário no misto exige cliente selecionado.');
      return;
    }
    if (parsed.cartao > 0 && !cardType) {
      setError('Informe se o cartão é Crédito ou Débito.');
      return;
    }
    if (dinheiroPart > 0) {
      if (parsed.received == null || receivedCents < dinheiroPart) {
        setError('Valor recebido em dinheiro insuficiente.');
        return;
      }
    }
    onConfirm({
      dinheiro: parsed.dinheiro,
      pix: parsed.pix,
      cartao: parsed.cartao,
      crediario: parsed.crediario,
      amount_received_cents: dinheiroPart > 0 ? receivedCents : 0,
      card_type: parsed.cartao > 0 ? cardType : null,
    });
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Pagamento misto">
      <div className="modal modal-wide">
        <h3>Pagamento misto</h3>
        <div className="kv-list" style={{ marginBottom: 12 }}>
          <div>
            <span>Total</span>
            <strong>{formatBRL(totalCents)}</strong>
          </div>
          <div>
            <span>Valor informado</span>
            <strong>{formatBRL(informed)}</strong>
          </div>
          <div>
            <span>Restante</span>
            <strong style={{ color: remaining === 0 ? undefined : '#b42318' }}>
              {formatBRL(remaining)}
            </strong>
          </div>
        </div>
        <div className="form-grid">
          <label>
            Dinheiro
            <input
              className="field-input"
              value={dinheiro}
              onChange={(e) => setDinheiro(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
            />
          </label>
          <label>
            Pix
            <input
              className="field-input"
              value={pix}
              onChange={(e) => setPix(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
            />
          </label>
          <label>
            Cartão
            <input
              className="field-input"
              value={cartao}
              onChange={(e) => setCartao(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
            />
          </label>
          <label>
            Crediário
            <input
              className="field-input"
              value={crediario}
              onChange={(e) => setCrediario(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
            />
          </label>
        </div>
        {(parsed.cartao ?? 0) > 0 ? (
          <div className="payment-options" style={{ marginTop: 10 }}>
            <button
              type="button"
              className={cardType === 'CREDIT' ? 'pay-btn active' : 'pay-btn'}
              onClick={() => setCardType('CREDIT')}
            >
              Crédito
            </button>
            <button
              type="button"
              className={cardType === 'DEBIT' ? 'pay-btn active' : 'pay-btn'}
              onClick={() => setCardType('DEBIT')}
            >
              Débito
            </button>
          </div>
        ) : null}
        {dinheiroPart > 0 && (
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label>
              Parte em dinheiro
              <input className="field-input" value={centsToInput(dinheiroPart)} readOnly />
            </label>
            <label>
              Valor recebido
              <input
                className="field-input"
                value={received}
                onChange={(e) => setReceived(e.target.value)}
                inputMode="decimal"
                placeholder={centsToInput(dinheiroPart)}
              />
            </label>
            <label>
              Troco
              <input className="field-input" value={centsToInput(troco)} readOnly />
            </label>
          </div>
        )}
        {!hasCustomer && (parsed.crediario ?? 0) > 0 && (
          <div className="alert alert-error" style={{ marginTop: 12 }}>
            Selecione um cliente para usar crediário no misto.
          </div>
        )}
        {error && (
          <div className="alert alert-error" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={submit}>
            Confirmar pagamento misto
          </button>
        </div>
      </div>
    </div>
  );
}
