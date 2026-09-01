import { useEffect, useMemo, useState } from 'react';
import {
  cashMovement,
  closeCash,
  fetchCashConference,
  fetchCashMovements,
  fetchCashSessions,
  fetchOpenCash,
  formatBRL,
  openCash,
  parseBRLToCents,
  type CashSession,
} from '../../api/client';
import { ModuleToolbar, StatusPill } from '../../components/ModuleChrome';
import ChoosePrinterModal from '../../components/ChoosePrinterModal';
import { printDocument } from '../../lib/printDocument';
import { savePdfToComputer } from '../../lib/savePdf';

export default function CaixaPage() {
  const [current, setCurrent] = useState<CashSession | null>(null);
  const [history, setHistory] = useState<CashSession[]>([]);
  const [movements, setMovements] = useState<
    Array<{
      id: number;
      movement_type: string;
      amount_cents: number;
      reason: string | null;
      created_at: string;
      payment_method: string | null;
    }>
  >([]);
  const [conference, setConference] = useState<{
    expected_amount_cents: number;
    breakdown: Record<string, number>;
  } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [choosePrinter, setChoosePrinter] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [operator, setOperator] = useState('Operador');
  const [opening, setOpening] = useState('50,00');
  const [moveType, setMoveType] = useState('sangria');
  const [moveAmount, setMoveAmount] = useState('0,00');
  const [moveReason, setMoveReason] = useState('');
  const [counted, setCounted] = useState('0,00');
  const [closeNotes, setCloseNotes] = useState('');

  async function load() {
    try {
      const [open, sessions] = await Promise.all([fetchOpenCash(), fetchCashSessions(30)]);
      setCurrent(open);
      setHistory(sessions);
      if (open) {
        const [conf, movs] = await Promise.all([
          fetchCashConference(open.id),
          fetchCashMovements(open.id),
        ]);
        setConference({
          expected_amount_cents: conf.expected_amount_cents,
          breakdown: conf.breakdown,
        });
        setMovements(movs);
        setCounted((conf.expected_amount_cents / 100).toFixed(2).replace('.', ','));
      } else {
        setConference(null);
        setMovements([]);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar caixa');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const expectedCents = conference?.expected_amount_cents ?? null;
  const countedCents = useMemo(() => parseBRLToCents(counted), [counted]);
  const liveDiffCents =
    expectedCents != null && countedCents != null ? countedCents - expectedCents : null;

  const expectedLabel = useMemo(
    () => (expectedCents != null ? formatBRL(expectedCents) : '—'),
    [expectedCents]
  );

  const b = conference?.breakdown;
  const cents = (key: string) => Number(b?.[key] ?? 0);

  /** FALTA / SOBRA / CAIXA CORRETO, em texto direto para o operador. */
  const diffLabel =
    liveDiffCents == null
      ? '—'
      : liveDiffCents === 0
        ? 'CAIXA CORRETO'
        : liveDiffCents > 0
          ? `SOBRA ${formatBRL(liveDiffCents)}`
          : `FALTA ${formatBRL(Math.abs(liveDiffCents))}`;

  async function handleClosingPdf() {
    if (!current) return;
    setExporting(true);
    setError(null);
    try {
      const res = await savePdfToComputer({
        suggestedName: `onca-pdv-fechamento-caixa-${current.id}.pdf`,
        downloadUrl: `/api/cash/sessions/${current.id}/pdf?download=1`,
        title: 'Salvar fechamento de caixa em PDF',
      });
      if (!res.ok && !res.canceled) setError(res.error || 'Não foi possível gerar o PDF.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao gerar PDF do fechamento');
    } finally {
      setExporting(false);
    }
  }

  async function handleOpen() {
    const cents = parseBRLToCents(opening);
    if (cents == null || !operator.trim()) {
      setError('Informe operador e valor inicial válidos');
      return;
    }
    try {
      await openCash({ operator_name: operator.trim(), opening_amount_cents: cents });
      setNotice('Caixa aberto.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao abrir caixa');
    }
  }

  async function handleMove() {
    const cents = parseBRLToCents(moveAmount);
    if (cents == null || cents <= 0 || !moveReason.trim()) {
      setError('Informe valor e motivo');
      return;
    }
    try {
      await cashMovement({
        movement_type: moveType,
        amount_cents: cents,
        reason: moveReason.trim(),
      });
      setNotice('Movimento de caixa registrado.');
      setMoveReason('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro no movimento');
    }
  }

  async function handleClose() {
    const cents = parseBRLToCents(counted);
    if (cents == null) {
      setError('Valor contado inválido');
      return;
    }
    try {
      const result = await closeCash({
        counted_amount_cents: cents,
        close_notes: closeNotes.trim() || undefined,
      });
      const diff = result.session.difference_cents ?? 0;
      setNotice(
        `Caixa fechado. Diferença: ${formatBRL(diff)} (${diff === 0 ? 'bateu' : diff > 0 ? 'sobra' : 'falta'})`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao fechar caixa');
    }
  }

  return (
    <section className="module-panel">
      <ModuleToolbar>
        <StatusPill tone={current ? 'ok' : 'warn'}>
          {current ? `Caixa aberto #${current.id}` : 'Caixa fechado'}
        </StatusPill>
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          Atualizar
        </button>
      </ModuleToolbar>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}

      {choosePrinter && current && (
        <ChoosePrinterModal
          kind="report"
          title="Imprimir fechamento de caixa"
          onCancel={() => setChoosePrinter(false)}
          onConfirm={(choice) => {
            setChoosePrinter(false);
            void printDocument({
              kind: 'report',
              title: `Fechamento de caixa #${current.id}`,
              documentType: 'fechamento_caixa',
              documentRef: String(current.id),
              printerName: choice.printerName || undefined,
              paperFormat: choice.paperFormat,
            }).then((res) => {
              if (!res.ok) setError(res.error || 'Não foi possível imprimir o fechamento.');
            });
          }}
        />
      )}

      <div className="cash-grid">
        {!current ? (
          <div className="side-card">
            <h3>Abrir caixa</h3>
            <div className="modal-fields">
              <label>
                Operador
                <input className="field-input" value={operator} onChange={(e) => setOperator(e.target.value)} />
              </label>
              <label>
                Valor inicial (R$)
                <input className="field-input" value={opening} onChange={(e) => setOpening(e.target.value)} />
              </label>
              <button type="button" className="btn btn-primary" onClick={() => void handleOpen()}>
                Abrir caixa
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="side-card">
              <h3>Vendas do período</h3>
              <p className="muted-line">
                Conferência do faturamento por forma de pagamento. Pix, cartões e crediário{' '}
                <strong>não entram</strong> no dinheiro esperado na gaveta.
              </p>
              <div className="kv-list cash-totalizer" data-testid="cash-vendas-periodo">
                <div><span>Dinheiro</span><strong>{formatBRL(cents('sales_dinheiro_cents'))}</strong></div>
                <div><span>Pix</span><strong>{formatBRL(cents('sales_pix_cents'))}</strong></div>
                <div><span>Cartão débito</span><strong>{formatBRL(cents('sales_cartao_debito_cents'))}</strong></div>
                <div><span>Cartão crédito</span><strong>{formatBRL(cents('sales_cartao_credito_cents'))}</strong></div>
                {cents('sales_cartao_legado_cents') > 0 ? (
                  <div>
                    <span>Cartão (sem tipo registrado)</span>
                    <strong>{formatBRL(cents('sales_cartao_legado_cents'))}</strong>
                  </div>
                ) : null}
                <div><span>Crediário</span><strong>{formatBRL(cents('sales_crediario_cents'))}</strong></div>
                <div><span>Outras formas</span><strong>{formatBRL(cents('sales_outras_cents'))}</strong></div>
                <div className="cash-line-strong">
                  <span>TOTAL VENDIDO</span>
                  <strong data-testid="cash-total-vendido">{formatBRL(cents('sales_total_cents'))}</strong>
                </div>
              </div>
            </div>

            <div className="side-card">
              <h3>Movimentações do caixa</h3>
              <p className="muted-line">Somente o que entra e sai de dinheiro físico.</p>
              <div className="kv-list cash-totalizer" data-testid="cash-movimentacoes">
                <div><span>Fundo / saldo inicial</span><strong>{formatBRL(cents('opening_amount_cents'))}</strong></div>
                <div><span>Dinheiro de vendas</span><strong>+ {formatBRL(cents('sales_dinheiro_cents'))}</strong></div>
                <div><span>Suprimentos</span><strong>+ {formatBRL(cents('suprimentos_cents'))}</strong></div>
                <div><span>Sangrias</span><strong>- {formatBRL(cents('sangrias_cents'))}</strong></div>
                <div>
                  <span>Cancelamentos em dinheiro</span>
                  <strong>- {formatBRL(cents('cancelamentos_dinheiro_cents'))}</strong>
                </div>
                <div className="cash-line-strong">
                  <span>VALOR ESPERADO EM DINHEIRO</span>
                  <strong data-testid="cash-expected">{expectedLabel}</strong>
                </div>
                <div>
                  <span>Dinheiro contado</span>
                  <strong>{countedCents != null ? formatBRL(countedCents) : '—'}</strong>
                </div>
                <div className="cash-line-strong">
                  <span>Diferença de caixa</span>
                  <strong
                    data-testid="cash-difference"
                    style={{
                      color: liveDiffCents == null || liveDiffCents === 0 ? '#0f3d2e' : '#b42318',
                    }}
                  >
                    {diffLabel}
                  </strong>
                </div>
              </div>
            </div>

            <div className="side-card">
              <h3>Resumo final</h3>
              <div className="kv-list cash-totalizer" data-testid="cash-resumo-final">
                <div><span>Operador</span><strong>{current.operator_name}</strong></div>
                <div><span>Abertura</span><strong>{current.opened_at}</strong></div>
                <div><span>Quantidade de vendas</span><strong>{cents('sales_count')}</strong></div>
                <div><span>Itens vendidos</span><strong>{cents('items_sold')}</strong></div>
                <div><span>Faturamento bruto</span><strong>{formatBRL(cents('gross_cents'))}</strong></div>
                <div><span>Descontos</span><strong>{formatBRL(cents('discount_cents'))}</strong></div>
                <div><span>Faturamento líquido</span><strong>{formatBRL(cents('net_cents'))}</strong></div>
                <div><span>Valor esperado</span><strong>{expectedLabel}</strong></div>
                <div>
                  <span>Valor contado</span>
                  <strong>{countedCents != null ? formatBRL(countedCents) : '—'}</strong>
                </div>
                <div><span>Diferença</span><strong>{diffLabel}</strong></div>
              </div>
              <div className="modal-actions" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setChoosePrinter(true)}
                >
                  IMPRIMIR FECHAMENTO
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={exporting}
                  onClick={() => void handleClosingPdf()}
                >
                  {exporting ? 'Gerando PDF…' : 'GERAR PDF'}
                </button>
              </div>
            </div>

            <div className="side-card">
              <h3>Sangria / Suprimento</h3>
              <div className="modal-fields">
                <label>
                  Tipo
                  <select className="field-input" value={moveType} onChange={(e) => setMoveType(e.target.value)}>
                    <option value="sangria">Sangria</option>
                    <option value="suprimento">Suprimento</option>
                    <option value="entrada">Entrada</option>
                    <option value="saida">Saída</option>
                  </select>
                </label>
                <label>
                  Valor (R$)
                  <input className="field-input" value={moveAmount} onChange={(e) => setMoveAmount(e.target.value)} />
                </label>
                <label>
                  Motivo
                  <input className="field-input" value={moveReason} onChange={(e) => setMoveReason(e.target.value)} />
                </label>
                <button type="button" className="btn btn-accent" onClick={() => void handleMove()}>
                  Registrar
                </button>
              </div>
            </div>

            <div className="side-card">
              <h3>Fechamento / Conferência</h3>
              <div className="modal-fields">
                <label>
                  Valor informado / contado em dinheiro (R$)
                  <input
                    className="field-input"
                    value={counted}
                    onChange={(e) => setCounted(e.target.value)}
                    data-testid="cash-counted-input"
                  />
                </label>
                <label>
                  Observações
                  <input className="field-input" value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} />
                </label>
                <button type="button" className="btn btn-primary" onClick={() => void handleClose()}>
                  Fechar caixa
                </button>
              </div>
            </div>
          </>
        )}

        <div className="side-card span-all">
          <h3>Movimentos da sessão</h3>
          <div className="product-table-wrap compact">
            <table className="history-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Tipo</th>
                  <th>Valor</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td>{m.created_at}</td>
                    <td>{m.movement_type}</td>
                    <td>{formatBRL(m.amount_cents)}</td>
                    <td>{m.reason || '—'}</td>
                  </tr>
                ))}
                {movements.length === 0 && (
                  <tr>
                    <td colSpan={4}>Sem movimentos.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="side-card span-all">
          <h3>Histórico de caixas</h3>
          <div className="product-table-wrap compact">
            <table className="history-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Operador</th>
                  <th>Status</th>
                  <th>Abertura</th>
                  <th>Fechamento</th>
                  <th>Vendas</th>
                  <th>Diferença</th>
                </tr>
              </thead>
              <tbody>
                {history.map((s) => (
                  <tr key={s.id}>
                    <td>{s.id}</td>
                    <td>{s.operator_name}</td>
                    <td>{s.status}</td>
                    <td>{s.opened_at}</td>
                    <td>{s.closed_at || '—'}</td>
                    <td>{formatBRL(s.sales_total_cents)}</td>
                    <td>
                      {s.difference_cents == null ? '—' : formatBRL(s.difference_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
