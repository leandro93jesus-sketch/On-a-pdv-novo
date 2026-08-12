type Props = {
  title?: string;
  confirmLabel?: string;
  onBack: () => void;
  onConfirm: () => void;
};

export default function CancelSaleConfirmModal({
  title = 'EXISTEM ITENS NO CARRINHO',
  confirmLabel = 'CANCELAR VENDA',
  onBack,
  onConfirm,
}: Props) {
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Confirmar cancelamento"
    >
      <div className="modal">
        <h3>{title}</h3>
        <p>Deseja realmente cancelar?</p>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onBack}>
            VOLTAR
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
