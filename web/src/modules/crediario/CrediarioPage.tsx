import { useEffect, useState } from 'react';
import {
  fetchCreditAccount,
  fetchCreditAccounts,
  fetchCreditSummary,
  formatBRL,
  parseBRLToCents,
  payCredit,
  type CreditAccount,
} from '../../api/client';
import { ModuleToolbar, StatusPill } from '../../components/ModuleChrome';

function tone(status: string): 'ok' | 'warn' | 'danger' | 'muted' | 'info' {
  if (status === 'quitado') return 'ok';
  if (status === 'parcialmente_pago' || status === 'aberto') return 'info';
  if (status === 'vencido') return 'danger';
  if (status === 'cancelado') return 'muted';
  return 'warn';
}

export default function CrediarioPage() {
  const [summary, setSummary] = useState({
    total_open_cents: 0,
    total_overdue_cents: 0,
    total_received_cents: 0,
    customers_with_balance: 0,
  });
  const [accounts, setAccounts] = useState<CreditAccount[]>([]);
  const [selected, setSelected] = useState<CreditAccount | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [payInput, setPayInput] = useState('');
  const [payMethod, setPayMethod] = useState('dinheiro');
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao abrir conta');
    }
  }

  async function pay(full = false) {
    if (!selected) return;
    const cents = full
      ? selected.balance_cents
      : parseBRLToCents(payInput);
    if (cents == null || cents <= 0) {
      setError('Informe um valor válido');
      return;
    }
    try {
      const updated = await payCredit({
        credit_account_id: selected.id,
        amount_cents: cents,
        method: payMethod,
      });
      setSelected(updated);
      setPayInput('');
      setNotice(
        updated.status === 'quitado'
          ? 'Conta quitada.'
          : `Pagamento de ${formatBRL(cents)} registrado.`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro no pagamento');
    }
  }

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

      <div className="split-panels">
        <div className="product-table-wrap">
          <table className="product-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Venda</th>
                <th>Total</th>
                <th>Saldo</th>
                <th>Parcelas</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} onClick={() => void openAccount(a.id)} style={{ cursor: 'pointer' }}>
                  <td>{a.customer_name || a.customer_id}</td>
                  <td>{a.sale_number || a.sale_id}</td>
                  <td>{formatBRL(a.total_cents)}</td>
                  <td>{formatBRL(a.balance_cents)}</td>
                  <td>{a.installment_count}</td>
                  <td>
                    <StatusPill tone={tone(a.status)}>{a.status}</StatusPill>
                  </td>
                </tr>
              ))}
              {accounts.length === 0 && (
                <tr>
                  <td colSpan={6}>Nenhuma conta de crediário.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="side-card">
          {!selected ? (
            <p className="cart-empty">Selecione uma conta para ver parcelas e pagar.</p>
          ) : (
            <>
              <h3>
                {selected.customer_name} · {selected.sale_number}
              </h3>
              <p>
                Total {formatBRL(selected.total_cents)} · Entrada {formatBRL(selected.entry_cents)} ·
                Saldo {formatBRL(selected.balance_cents)}
              </p>
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

              {selected.balance_cents > 0 && selected.status !== 'cancelado' ? (
                <div className="form-grid" style={{ marginTop: '0.75rem' }}>
                  <label>
                    Valor
                    <input
                      className="field-input"
                      value={payInput}
                      onChange={(e) => setPayInput(e.target.value)}
                      placeholder="0,00"
                    />
                  </label>
                  <label>
                    Forma
                    <select
                      className="field-input"
                      value={payMethod}
                      onChange={(e) => setPayMethod(e.target.value)}
                    >
                      <option value="dinheiro">Dinheiro</option>
                      <option value="pix">Pix</option>
                      <option value="cartao">Cartão</option>
                    </select>
                  </label>
                  <div className="modal-actions span-2">
                    <button type="button" className="btn btn-ghost" onClick={() => void pay(false)}>
                      Pagamento parcial
                    </button>
                    <button type="button" className="btn btn-primary" onClick={() => void pay(true)}>
                      Quitar
                    </button>
                  </div>
                </div>
              ) : null}

              {selected.status === 'quitado' ? (
                <div className="alert alert-ok" style={{ marginTop: '0.75rem' }}>
                  Recibo: conta {selected.id} quitada — venda {selected.sale_number} — total{' '}
                  {formatBRL(selected.total_cents)}.
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
