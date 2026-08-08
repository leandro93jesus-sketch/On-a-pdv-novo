import type { Sale } from '../../api/client';
import { formatBRL, paymentLabel } from '../../api/client';

interface Props {
  sale: Sale;
  onClose: () => void;
}

export default function ReceiptModal({ sale, onClose }: Props) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Comprovante da venda">
      <div className="modal">
        <div className="receipt" data-testid="receipt">
          <div className="receipt-header">
            <strong>ONÇA PDV</strong>
            <span>Comprovante de Venda</span>
          </div>

          <div className="receipt-meta">
            <div>
              <strong>Nº</strong> {sale.sale_number}
            </div>
            <div>
              <strong>Data</strong> {sale.created_at}
            </div>
            <div>
              <strong>Status</strong> {sale.status === 'completed' ? 'Concluída' : sale.status}
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Qtd</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {(sale.items ?? []).map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.name}
                    {item.is_misc ? ' (Diversos)' : ''}
                  </td>
                  <td>{item.quantity}</td>
                  <td>{formatBRL(item.line_total_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="receipt-totals">
            <div className="summary-row">
              <span>Subtotal</span>
              <span>{formatBRL(sale.subtotal_cents)}</span>
            </div>
            <div className="summary-row">
              <span>Desconto</span>
              <span>{formatBRL(sale.discount_cents)}</span>
            </div>
            <div className="summary-row big">
              <span>Total</span>
              <span>{formatBRL(sale.total_cents)}</span>
            </div>
            {(sale.payments ?? []).map((p) => (
              <div className="summary-row" key={p.id}>
                <span>{paymentLabel(p.method)}</span>
                <span>{formatBRL(p.amount_cents)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="modal-actions no-print">
          <button type="button" className="btn btn-ghost" onClick={() => window.print()}>
            Imprimir
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
