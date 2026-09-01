import { useEffect, useState } from 'react';
import {
  fetchCreditAccount,
  fetchCreditAccounts,
  fetchCreditSummary,
  formatBRL,
  generateCreditAccountPdfApi,
  parseBRLToCents,
  payCredit,
  type CreditAccount,
} from '../../api/client';
import { ModuleToolbar, StatusPill } from '../../components/ModuleChrome';
import { savePdfToComputer } from '../../lib/savePdf';

function tone(status: string): 'ok' | 'warn' | 'danger' | 'muted' | 'info' {
  if (status === 'quitado') return 'ok';
  if (status === 'parcialmente_pago' || status === 'aberto') return 'info';
  if (status === 'vencido') return 'danger';
  if (status === 'cancelado') return 'muted';
  return 'warn';
}

function paidCents(a: CreditAccount): number {
  if (typeof a.paid_cents === 'number') return a.paid_cents;
  return Math.max(0, a.total_cents - a.balance_cents);
}

/**
 * Crediário enxuto: lista só o essencial; Receber = modal curto; Abrir = detalhes.
 */
export default function CrediarioPage() {
  const [summary, setSummary] = useState({
    total_open_cents: 0,
    total_overdue_cents: 0,
    total_received_cents: 0,
    customers_with_balance: 0,
  });
  const [accounts, setAccounts] = useState<CreditAccount[]>([]);
  const [selected, setSelected] = useState<CreditAccount | null>(null);
  const [payTarget, setPayTarget] = useState<CreditAccount | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [payInput, setPayInput] = useState('');
  const [payMethod, setPayMethod] = useState('dinheiro');
  const [payBusy, setPayBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    try {
      const [s, list] = await Promise.all([
        fetchCreditSummary(),
        fetchCreditAccounts({ status: statusFilter || undefined }),
      ]);
      setSummary(s);
      setAccounts(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar crediário');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function openAccount(id: number) {
    try {
      const full = await fetchCreditAccount(id);
      setSelected(full);
      setPayTarget(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao abrir conta');
    }
  }

  async function openReceive(id: number) {
    try {
      const full = await fetchCreditAccount(id);
      setPayTarget(full);
      setPayInput('');
      setPayMethod('dinheiro');
      setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao abrir recebimento');
    }
  }

  async function pay(full = false) {
    if (!payTarget) return;
    const cents = full ? payTarget.balance_cents : parseBRLToCents(payInput);
    if (cents == null || cents <= 0) {
      setError('Informe um valor válido');
      return;
    }
    setPayBusy(true);
    try {
      const updated = await payCredit({
        credit_account_id: payTarget.id,
        amount_cents: cents,
        method: payMethod,
      });
      setPayTarget(null);
      setPayInput('');
      setNotice(
        updated.status === 'quitado'
          ? 'Conta quitada.'
          : `Pagamento de ${formatBRL(cents)} registrado.`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro no pagamento');
    } finally {
      setPayBusy(false);
    }
  }

  async function saveCreditPdf() {
    if (!selected) return;
    try {
      const meta = await generateCreditAccountPdfApi(selected.id, { force: true });
      const result = await savePdfToComputer({
        suggestedName: meta.filename || `ONCA-CREDIARIO-${String(selected.id).padStart(6, '0')}.pdf`,
        downloadUrl: meta.download_url,
        absolutePath: meta.absolute_path,
        title: 'Salvar comprovante de crediário em PDF',
      });
      if (result.canceled) {
        setNotice('Salvar PDF cancelado.');
        return;
      }
      if (!result.ok) {
        setError(result.error || 'Falha ao salvar PDF');
        return;
      }
      setNotice(
        result.filePath ? `PDF salvo em: ${result.filePath}` : 'PDF de crediário baixado.'
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao gerar PDF do crediário');
    }
  }

  const receiveRemaining =
    payTarget && payInput.trim()
      ? (() => {
          const cents = parseBRLToCents(payInput);
          if (cents == null) return null;
          return Math.max(0, payTarget.balance_cents - cents);
        })()
      : payTarget
        ? payTarget.balance_cents
        : null;

  return (
    <section className="module-panel">
      <ModuleToolbar>
        <select
          className="field-input"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">Todos</option>
          <option value="aberto">Aberto</option>
          <option value="parcialmente_pago">Parcialmente pago</option>
          <option value="quitado">Quitado</option>
          <option value="vencido">Vencido</option>
          <option value="cancelado">Cancelado</option>
        </select>
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          Atualizar
        </button>
      </ModuleToolbar>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}

      <div className="stats-row">
        <div className="stat-card">
          <span>Total a receber</span>
          <strong>{formatBRL(summary.total_open_cents)}</strong>
        </div>
        <div className="stat-card">
          <span>Total vencido</span>
          <strong>{formatBRL(summary.total_overdue_cents)}</strong>
        </div>
        <div className="stat-card">
          <span>Total recebido</span>
          <strong>{formatBRL(summary.total_received_cents)}</strong>
        </div>
        <div className="stat-card">
          <span>Clientes em aberto</span>
          <strong>{summary.customers_with_balance}</strong>
        </div>
      </div>

      <div className="product-table-wrap">
        <table className="product-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Total da dívida</th>
              <th>Pago</th>
              <th>Saldo</th>
              <th>Vencimento</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td>{a.customer_name || a.customer_id}</td>
                <td>{formatBRL(a.total_cents)}</td>
                <td>{formatBRL(paidCents(a))}</td>
                <td>{formatBRL(a.balance_cents)}</td>
                <td>{a.next_due_date || '—'}</td>
                <td>
                  <StatusPill tone={tone(a.status)}>{a.status}</StatusPill>
                </td>
                <td className="row-actions">
                  {a.balance_cents > 0 && a.status !== 'cancelado' ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void openReceive(a.id)}
                    >
                      Receber
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void openAccount(a.id)}
                  >
                    Abrir
                  </button>
                </td>
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr>
                <td colSpan={7}>Nenhuma conta de crediário.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {payTarget ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Receber crediário">
          <div className="modal">
            <h3>Receber</h3>
            <p className="muted-line">{payTarget.customer_name}</p>
            <div className="modal-fields">
              <div>
                <strong>Saldo atual</strong>
                <div>{formatBRL(payTarget.balance_cents)}</div>
              </div>
              <label>
                Valor recebido agora
                <input
                  className="field-input"
                  value={payInput}
                  onChange={(e) => setPayInput(e.target.value)}
                  placeholder="0,00"
                  inputMode="decimal"
                  autoFocus
                  disabled={payBusy}
                />
              </label>
              <label>
                Forma de pagamento
                <select
                  className="field-input"
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value)}
                  disabled={payBusy}
                >
                  <option value="dinheiro">Dinheiro</option>
                  <option value="pix">Pix</option>
                  <option value="cartao">Cartão</option>
                </select>
              </label>
              <div>
                <strong>Saldo restante</strong>
                <div>{receiveRemaining == null ? '—' : formatBRL(receiveRemaining)}</div>
              </div>
            </div>
            <div className="modal-actions" style={{ flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={payBusy}
                onClick={() => setPayTarget(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={payBusy}
                onClick={() => void pay(false)}
              >
                Confirmar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={payBusy}
                onClick={() => void pay(true)}
              >
                Quitar saldo
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selected ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Detalhe crediário">
          <div className="modal modal-wide">
            <h3>
              {selected.customer_name} · {selected.sale_number}
            </h3>
            <p>
              Total {formatBRL(selected.total_cents)} · Entrada {formatBRL(selected.entry_cents)} ·
              Saldo {formatBRL(selected.balance_cents)}
            </p>
            <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-accent" onClick={() => void saveCreditPdf()}>
                Salvar PDF
              </button>
              {selected.balance_cents > 0 && selected.status !== 'cancelado' ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setPayTarget(selected);
                    setSelected(null);
                    setPayInput('');
                  }}
                >
                  Receber
                </button>
              ) : null}
            </div>
            <table className="history-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Vencimento</th>
                  <th>Valor</th>
                  <th>Pago</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(selected.installments || []).map((i) => (
                  <tr key={i.id}>
                    <td>{i.installment_number}</td>
                    <td>{i.due_date}</td>
                    <td>{formatBRL(i.amount_cents)}</td>
                    <td>{formatBRL(i.paid_cents)}</td>
                    <td>{i.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h4 style={{ marginTop: '0.75rem' }}>Pagamentos</h4>
            <ul>
              {(selected.payments || []).map((p) => (
                <li key={p.id}>
                  {p.paid_at} · {formatBRL(p.amount_cents)} · {p.method}
                  {p.is_reversal ? ' (estorno)' : ''}
                </li>
              ))}
              {(selected.payments || []).length === 0 ? <li>Sem pagamentos.</li> : null}
            </ul>

            {selected.status === 'quitado' ? (
              <div className="alert alert-ok" style={{ marginTop: '0.75rem' }}>
                Conta quitada — venda {selected.sale_number} — total {formatBRL(selected.total_cents)}.
              </div>
            ) : null}

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setSelected(null)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
