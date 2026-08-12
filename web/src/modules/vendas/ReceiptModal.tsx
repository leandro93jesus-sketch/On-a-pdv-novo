import { useState } from 'react';
import type { ReceiptPdfMeta, Sale } from '../../api/client';
import {
  buildReceiptPdfUrl,
  formatBRL,
  generateSaleReceiptPdfApi,
  paymentLabel,
  whatsappShareApi,
} from '../../api/client';
import BrandLogo from '../../components/BrandLogo';
import ChoosePrinterModal, { type ChoosePrinterResult } from '../../components/ChoosePrinterModal';
import { printDocument } from '../../lib/printDocument';

interface Props {
  sale: Sale;
  onClose: () => void;
  onCancelSale?: (sale: Sale) => void;
  companyName?: string;
  /** Destaca conclusão bem-sucedida e botão Nova venda. */
  successBanner?: boolean;
}

export default function ReceiptModal({
  sale,
  onClose,
  onCancelSale,
  companyName,
  successBanner = false,
}: Props) {
  const cancelled = sale.status === 'cancelled';
  const [waNote, setWaNote] = useState<string | null>(null);
  const [waBusy, setWaBusy] = useState(false);
  const [waPhone, setWaPhone] = useState(sale.customer?.phone || sale.customer?.whatsapp || '');
  const [showOtherPhone, setShowOtherPhone] = useState(false);
  const [pdfMeta, setPdfMeta] = useState<ReceiptPdfMeta | null>(null);
  const [choosePrinter, setChoosePrinter] = useState(false);
  const [printNote, setPrintNote] = useState<string | null>(null);
  const [printBusy, setPrintBusy] = useState(false);
  const brand = companyName?.trim() || 'ONÇA PRODUTOS DE LIMPEZA';
  const showSuccess = successBanner && !cancelled;

  function openPdf(opts?: { download?: boolean; regen?: boolean }) {
    window.open(buildReceiptPdfUrl(sale.id, opts), '_blank', 'noopener,noreferrer');
  }

  async function ensurePdf(force = false) {
    const meta = await generateSaleReceiptPdfApi(sale.id, { force });
    setPdfMeta(meta);
    return meta;
  }

  async function doPrint(choice: ChoosePrinterResult) {
    setChoosePrinter(false);
    setPrintBusy(true);
    setPrintNote(null);
    try {
      const res = await printDocument({
        kind: 'receipt',
        title: `Comprovante ${sale.sale_number}`,
        documentType: 'comprovante',
        documentRef: sale.sale_number,
        printerName: choice.printerName || undefined,
        paperFormat: choice.paperFormat,
      });
      if (!res.ok) {
        setPrintNote(
          showSuccess
            ? `Venda concluída. Não foi possível imprimir.${res.error ? ` ${res.error}` : ''}`
            : res.error || 'Não foi possível imprimir.'
        );
      }
    } finally {
      setPrintBusy(false);
    }
  }

  async function sendWhatsAppPdf() {
    setWaBusy(true);
    setWaNote(null);
    try {
      const share = await whatsappShareApi(sale.id, {
        phone: waPhone.trim() || undefined,
      });
      if (share.pdf) setPdfMeta(share.pdf);
      setWaNote(
        share.note ||
          'PDF GERADO COM SUCESSO. Anexe o arquivo PDF na conversa do WhatsApp (anexo automático indisponível neste ambiente).'
      );
      // Abre o PDF para facilitar o anexo; depois a conversa.
      window.open(share.pdf?.view_url || buildReceiptPdfUrl(sale.id), '_blank', 'noopener,noreferrer');
      window.setTimeout(() => {
        window.open(share.url, '_blank', 'noopener,noreferrer');
      }, 350);
    } catch (e) {
      setWaNote(e instanceof Error ? e.message : 'Falha ao gerar PDF / WhatsApp');
    } finally {
      setWaBusy(false);
    }
  }

  async function copyPath() {
    const meta = pdfMeta || (await ensurePdf(false));
    const text = meta.absolute_path || meta.relative_path;
    try {
      await navigator.clipboard.writeText(text);
      setWaNote(`Caminho copiado: ${text}`);
    } catch {
      setWaNote(`Caminho do PDF: ${text}`);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Comprovante da venda">
      <div className="modal">
        {showSuccess && (
          <div className="alert alert-ok" style={{ marginBottom: 12 }}>
            <strong>Venda concluída com sucesso</strong>
            <div>
              Venda nº {sale.sale_number} · Total {formatBRL(sale.total_cents)}
            </div>
          </div>
        )}
        <div className="receipt" data-testid="receipt">
          <div className="receipt-header">
            <BrandLogo size={40} />
            <strong>{brand}</strong>
            <span>COMPROVANTE DE VENDA</span>
          </div>

          <div className="receipt-meta">
            <div>
              <strong>Nº</strong> {sale.sale_number}
            </div>
            <div>
              <strong>Data</strong> {sale.created_at}
            </div>
            <div>
              <strong>Status</strong> {cancelled ? 'Cancelada' : 'Concluída'}
            </div>
            {sale.customer?.name && (
              <div>
                <strong>Cliente</strong> {sale.customer.name}
              </div>
            )}
            {(sale.customer?.phone || sale.customer?.whatsapp) && (
              <div>
                <strong>Telefone</strong> {sale.customer?.whatsapp || sale.customer?.phone}
              </div>
            )}
            {cancelled && (
              <>
                <div>
                  <strong>Cancelada em</strong> {sale.cancelled_at}
                </div>
                <div>
                  <strong>Motivo</strong> {sale.cancel_reason}
                </div>
                <div>
                  <strong>Responsável</strong> {sale.cancelled_by}
                </div>
              </>
            )}
          </div>

          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Qtd</th>
                <th>Unit.</th>
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
                  <td>{formatBRL(item.unit_price_cents)}</td>
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
                <span>{paymentLabel(p.method, p.card_type)}</span>
                <span>{formatBRL(p.amount_cents)}</span>
              </div>
            ))}
            {(sale.amount_received_cents ?? 0) > 0 && (
              <div className="summary-row">
                <span>Valor recebido</span>
                <span>{formatBRL(sale.amount_received_cents || 0)}</span>
              </div>
            )}
            {(sale.change_cents ?? 0) > 0 && (
              <div className="summary-row">
                <span>Troco</span>
                <span>{formatBRL(sale.change_cents || 0)}</span>
              </div>
            )}
          </div>
        </div>

        {!cancelled && (
          <div className="no-print" style={{ marginTop: 12 }}>
            {(showOtherPhone || !(sale.customer?.phone || sale.customer?.whatsapp)) && (
              <label style={{ display: 'grid', gap: 4, fontSize: '0.9rem' }}>
                Número do WhatsApp
                <input
                  className="field-input"
                  placeholder="DDD + número"
                  value={waPhone}
                  onChange={(e) => setWaPhone(e.target.value)}
                />
              </label>
            )}
            {!showOtherPhone && (sale.customer?.phone || sale.customer?.whatsapp) ? (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ marginTop: 8 }}
                onClick={() => setShowOtherPhone(true)}
              >
                Informar outro número
              </button>
            ) : null}
          </div>
        )}

        {waNote && (
          <div className="alert alert-ok no-print" style={{ marginTop: 12 }}>
            <strong>PDF GERADO COM SUCESSO</strong>
            <div style={{ marginTop: 6 }}>{waNote}</div>
            {pdfMeta && (
              <div style={{ marginTop: 6, fontSize: '0.9rem' }}>
                Arquivo: <code>{pdfMeta.filename}</code>
                <br />
                Pasta: <code>{pdfMeta.folder_path}</code>
              </div>
            )}
            <div className="modal-actions" style={{ marginTop: 10, justifyContent: 'flex-start' }}>
              <button type="button" className="btn btn-ghost" onClick={() => openPdf()}>
                Abrir PDF
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => void copyPath()}>
                Copiar caminho
              </button>
              <button
                type="button"
                className="btn btn-accent"
                onClick={() => openPdf({ download: true })}
              >
                Baixar PDF
              </button>
            </div>
          </div>
        )}
        {printNote && (
          <div className="alert alert-error no-print">
            {printNote}
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="btn btn-accent"
                disabled={printBusy}
                onClick={() => setChoosePrinter(true)}
              >
                Tentar novamente
              </button>
            </div>
          </div>
        )}

        <div className="modal-actions no-print">
          {!cancelled && onCancelSale && !showSuccess && (
            <button type="button" className="btn btn-danger" onClick={() => onCancelSale(sale)}>
              Cancelar venda
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            disabled={printBusy}
            onClick={() => setChoosePrinter(true)}
          >
            Imprimir
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void ensurePdf(false).then(() => openPdf())}
          >
            Visualizar PDF
          </button>
          <button
            type="button"
            className="btn btn-accent"
            disabled={waBusy || cancelled}
            onClick={() => void sendWhatsAppPdf()}
          >
            Enviar PDF no WhatsApp
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {showSuccess ? 'Nova venda' : 'Fechar'}
          </button>
        </div>
      </div>
      {choosePrinter && (
        <ChoosePrinterModal
          kind="receipt"
          title="Escolher impressora"
          onCancel={() => setChoosePrinter(false)}
          onConfirm={(r) => void doPrint(r)}
        />
      )}
    </div>
  );
}
