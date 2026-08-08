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

  const expectedLabel = useMemo(
    () => (conference ? formatBRL(conference.expected_amount_cents) : '—'),
    [conference]
  );

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
              <h3>Sessão atual</h3>
              <div className="kv-list">
                <div><span>Operador</span><strong>{current.operator_name}</strong></div>
                <div><span>Abertura</span><strong>{current.opened_at}</strong></div>
                <div><span>Fundo</span><strong>{formatBRL(current.opening_amount_cents)}</strong></div>
                <div><span>Vendas</span><strong>{formatBRL(current.sales_total_cents)}</strong></div>
                <div><span>Dinheiro</span><strong>{formatBRL(current.sales_dinheiro_cents)}</strong></div>
                <div><span>Pix</span><strong>{formatBRL(current.sales_pix_cents)}</strong></div>
                <div><span>Cartão</span><strong>{formatBRL(current.sales_cartao_cents)}</strong></div>
                <div><span>Entradas</span><strong>{formatBRL(current.cash_in_cents)}</strong></div>
                <div><span>Saídas</span><strong>{formatBRL(current.cash_out_cents)}</strong></div>
                <div><span>Esperado (dinheiro)</span><strong>{expectedLabel}</strong></div>
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
                  Valor contado em dinheiro (R$)
                  <input className="field-input" value={counted} onChange={(e) => setCounted(e.target.value)} />
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
