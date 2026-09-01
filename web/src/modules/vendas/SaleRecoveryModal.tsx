import { formatBRL } from '../../api/client';

type Props = {
  itemCount: number;
  unitCount?: number;
  approxTotalCents?: number;
  time?: string;
  onRecover: () => void;
  onDiscard: () => void;
};

export default function SaleRecoveryModal({
  itemCount,
  unitCount,
  approxTotalCents,
  time,
  onRecover,
  onDiscard,
}: Props) {
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Venda não finalizada"
    >
      <div className="modal">
        <h3>VENDA NÃO FINALIZADA</h3>
        <p className="muted-line">
          O sistema encontrou uma venda em andamento que não foi concluída. Nada foi registrado
          no estoque nem no caixa.
        </p>
        <div className="kv-list" style={{ marginBottom: 12 }} data-testid="recovery-resumo">
          <div>
            <span>Horário</span>
            <strong>{time || '—'}</strong>
          </div>
          <div>
            <span>Itens</span>
            <strong>
              {itemCount}
              {unitCount != null && unitCount !== itemCount ? ` (${unitCount} unidades)` : ''}
            </strong>
          </div>
          <div>
            <span>Valor aproximado</span>
            <strong>{approxTotalCents != null ? formatBRL(approxTotalCents) : '—'}</strong>
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onDiscard}>
            DESCARTAR
          </button>
          <button type="button" className="btn btn-primary" onClick={onRecover}>
            RECUPERAR VENDA
          </button>
        </div>
      </div>
    </div>
  );
}
