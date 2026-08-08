import { useEffect, useState } from 'react';
import {
  createCustomer,
  fetchCustomerPurchases,
  fetchCustomers,
  formatBRL,
  inactivateCustomer,
  paymentLabel,
  updateCustomer,
  type Customer,
  type Sale,
} from '../../api/client';
import { ModuleToolbar, StatusPill } from '../../components/ModuleChrome';

const empty = {
  name: '',
  document: '',
  phone: '',
  whatsapp: '',
  address: '',
  address_number: '',
  neighborhood: '',
  city: '',
  state: '',
  zip_code: '',
  notes: '',
  active: true,
};

export default function ClientesPage() {
  const [items, setItems] = useState<Customer[]>([]);
  const [q, setQ] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState(empty);
  const [history, setHistory] = useState<Sale[]>([]);
  const [selected, setSelected] = useState<Customer | null>(null);

  async function load() {
    try {
      setItems(await fetchCustomers({ q: q.trim() || undefined, include_inactive: includeInactive }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar clientes');
    }
  }

  useEffect(() => {
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          setItems(
            await fetchCustomers({ q: q.trim() || undefined, include_inactive: includeInactive })
          );
          setError(null);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Erro ao carregar clientes');
        }
      })();
    }, 200);
    return () => window.clearTimeout(t);
  }, [q, includeInactive]);

  function openCreate() {
    setEditing(null);
    setForm(empty);
    setShowForm(true);
  }

  function openEdit(c: Customer) {
    setEditing(c);
    setForm({
      name: c.name,
      document: c.document || '',
      phone: c.phone || '',
      whatsapp: c.whatsapp || '',
      address: c.address || '',
      address_number: c.address_number || '',
      neighborhood: c.neighborhood || '',
      city: c.city || '',
      state: c.state || '',
      zip_code: c.zip_code || '',
      notes: c.notes || '',
      active: Boolean(c.active),
    });
    setShowForm(true);
  }

  async function save() {
    if (!form.name.trim()) {
      setError('Nome é obrigatório');
      return;
    }
    try {
      const payload = {
        name: form.name.trim(),
        document: form.document.trim() || null,
        phone: form.phone.trim() || null,
        whatsapp: form.whatsapp.trim() || null,
        address: form.address.trim() || null,
        address_number: form.address_number.trim() || null,
        neighborhood: form.neighborhood.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        zip_code: form.zip_code.trim() || null,
        notes: form.notes.trim() || null,
        active: form.active,
      };
      if (editing) await updateCustomer(editing.id, payload);
      else await createCustomer(payload);
      setShowForm(false);
      setNotice(editing ? 'Cliente atualizado.' : 'Cliente cadastrado.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar cliente');
    }
  }

  async function showPurchases(c: Customer) {
    setSelected(c);
    try {
      setHistory(await fetchCustomerPurchases(c.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro no histórico');
    }
  }

  async function inactivate(c: Customer) {
    if (!window.confirm(`Inativar cliente "${c.name}"?`)) return;
    try {
      await inactivateCustomer(c.id);
      setNotice('Cliente inativado.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao inativar');
    }
  }

  return (
    <section className="module-panel">
      <ModuleToolbar>
        <input
          className="search-input"
          placeholder="Buscar cliente…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="check-inline">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          Incluir inativos
        </label>
        <button type="button" className="btn btn-primary" onClick={openCreate}>
          Novo cliente
        </button>
      </ModuleToolbar>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}

      <div className="split-panels">
        <div className="product-table-wrap">
          <table className="product-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Documento</th>
                <th>Telefone</th>
                <th>Cidade</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.document || '—'}</td>
                  <td>{c.phone || c.whatsapp || '—'}</td>
                  <td>{c.city || '—'}</td>
                  <td>
                    <StatusPill tone={c.active ? 'ok' : 'muted'}>
                      {c.active ? 'Ativo' : 'Inativo'}
                    </StatusPill>
                  </td>
                  <td className="row-actions">
                    <button type="button" className="btn btn-ghost" onClick={() => openEdit(c)}>
                      Editar
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => void showPurchases(c)}>
                      Compras
                    </button>
                    {c.active ? (
                      <button type="button" className="btn btn-danger" onClick={() => void inactivate(c)}>
                        Inativar
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="side-card">
          <h3>Histórico de compras {selected ? `· ${selected.name}` : ''}</h3>
          {!selected ? (
            <p className="cart-empty">Selecione um cliente e clique em Compras.</p>
          ) : (
            <table className="history-table">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Data</th>
                  <th>Status</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {history.map((s) => (
                  <tr key={s.id}>
                    <td>{s.sale_number}</td>
                    <td>{s.created_at}</td>
                    <td>{s.status}</td>
                    <td>
                      {formatBRL(s.total_cents)} · {paymentLabel(s.payment_method)}
                    </td>
                  </tr>
                ))}
                {history.length === 0 && (
                  <tr>
                    <td colSpan={4}>Sem compras.</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showForm && (
        <div className="modal-backdrop">
          <div className="modal modal-wide">
            <h3>{editing ? 'Editar cliente' : 'Novo cliente'}</h3>
            <div className="form-grid">
              <label className="span-2">
                Nome *
                <input className="field-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label>
                CPF/CNPJ
                <input className="field-input" value={form.document} onChange={(e) => setForm({ ...form, document: e.target.value })} />
              </label>
              <label>
                Telefone
                <input className="field-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </label>
              <label>
                WhatsApp
                <input className="field-input" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
              </label>
              <label>
                CEP
                <input className="field-input" value={form.zip_code} onChange={(e) => setForm({ ...form, zip_code: e.target.value })} />
              </label>
              <label className="span-2">
                Endereço
                <input className="field-input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </label>
              <label>
                Número
                <input className="field-input" value={form.address_number} onChange={(e) => setForm({ ...form, address_number: e.target.value })} />
              </label>
              <label>
                Bairro
                <input className="field-input" value={form.neighborhood} onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} />
              </label>
              <label>
                Cidade
                <input className="field-input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </label>
              <label>
                Estado
                <input className="field-input" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
              </label>
              <label className="span-2">
                Observações
                <input className="field-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void save()}>
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
