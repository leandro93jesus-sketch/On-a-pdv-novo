type Props = {
  itemCount: number;
  onRecover: () => void;
  onDiscard: () => void;
};

export default function SaleRecoveryModal({ itemCount, onRecover, onDiscard }: Props) {
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Venda não finalizada"
    >
      <div className="modal">
        <h3>EXISTE UMA VENDA NÃO FINALIZADA</h3>
        <p>
          Foi encontrada uma venda em andamento
          {itemCount > 0 ? ` com ${itemCount} item(ns) no carrinho` : ''}.
          Ela não será apagada automaticamente.
        </p>
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
