interface Props {
  title?: string;
  text: string;
  html?: string;
  onClose: () => void;
}

/** Pré-visualização do cupom. Não envia nada à impressora. */
export default function CupomPreviewModal({ title, text, html, onClose }: Props) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Pré-visualização do cupom">
      <div className="modal" style={{ maxWidth: 480 }}>
        <h3>{title || 'TESTAR CUPOM SEM IMPRIMIR'}</h3>
        <p className="muted-line">Isto é só visualização. Nenhum papel será gasto.</p>
        <pre className="cupom-preview-box">{text}</pre>
        {html ? (
          <iframe
            title="Pré-visualização HTML do cupom"
            className="cupom-preview-frame"
            srcDoc={html}
            sandbox=""
          />
        ) : null}
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
