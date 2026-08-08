import { useEffect, useState } from 'react';
import {
  createSupplier,
  fetchSupplierPurchases,
  fetchSuppliers,
  formatBRL,
  inactivateSupplier,
  updateSupplier,
  type Purchase,
  type Supplier,
} from '../../api/client';
import { ModuleToolbar, StatusPill } from '../../components/ModuleChrome';

const empty = {
  name: '',
  trade_name: '',
  document: '',
  phone: '',
  whatsapp: '',
  email: '',
  address: '',
  address_number: '',
  neighborhood: '',
  city: '',
  state: '',
  zip_code: '',
  contact_name: '',
  notes: '',
  active: true,
};

export default function FornecedoresPage() {
  const [items, setItems] = useState<Supplier[]>([]);
  const [q, setQ] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState(empty);
  const [history, setHistory] = useState<Purchase[]>([]);
  const [selected, setSelected] = useState<Supplier | null>(null);

  async function load() {
    try {
      setItems(await fetchSuppliers({ q: q.trim() || undefined, include_inactive: includeInactive }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar fornecedores');
    }
  }

  useEffect(() => {
    const t = window.setTimeout(() => {
      void load();
    }, 200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce on filters
  }, [q, includeInactive]);

  function openCreate() {
    setEditing(null);
    setForm(empty);
    setShowForm(true);
  }

  function openEdit(s: Supplier) {
    setEditing(s);
    setForm({
      name: s.name,
      trade_name: s.trade_name || '',
      document: s.document || '',
      phone: s.phone || '',
      whatsapp: s.whatsapp || '',
      email: s.email || '',
      address: s.address || '',
      address_number: s.address_number || '',
      neighborhood: s.neighborhood || '',
      city: s.city || '',
      state: s.state || '',
      zip_code: s.zip_code || '',
      contact_name: s.contact_name || '',
      notes: s.notes || '',
      active: Boolean(s.active),
    });
    setShowForm(true);
  }

  async function save() {
    if (!form.name.trim()) {
      setError('Nome/razão social é obrigatório');
      return;
    }
    try {
      const payload = {
        name: form.name.trim(),
        trade_name: form.trade_name.trim() || null,
        document: form.document.trim() || null,
        phone: form.phone.trim() || null,
        whatsapp: form.whatsapp.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        address_number: form.address_number.trim() || null,
        neighborhood: form.neighborhood.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        zip_code: form.zip_code.trim() || null,
        contact_name: form.contact_name.trim() || null,
        notes: form.notes.trim() || null,
        active: form.active,
      };
      if (editing) await updateSupplier(editing.id, payload);
      else await createSupplier(payload);
      setShowForm(false);
      setNotice(editing ? 'Fornecedor atualizado.' : 'Fornecedor cadastrado.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar fornecedor');
    }
  }

  async function showPurchases(s: Supplier) {
    setSelected(s);
    try {
      setHistory(await fetchSupplierPurchases(s.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro no histórico');
    }
  }

  async function inactivate(s: Supplier) {
    if (!window.confirm(`Inativar fornecedor "${s.name}"?`)) return;
    try {
      await inactivateSupplier(s.id);
      setNotice('Fornecedor inativado.');
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
          placeholder="Buscar fornecedor…"
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
          Novo fornecedor
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
                <th>Contato</th>
                <th>Cidade</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.name}
                    {s.trade_name ? <div className="muted-line">{s.trade_name}</div> : null}
                  </td>
                  <td>{s.document || '—'}</td>
                  <td>{s.contact_name || s.phone || s.whatsapp || '—'}</td>
                  <td>{s.city || '—'}</td>
                  <td>
                    <StatusPill tone={s.active ? 'ok' : 'muted'}>
                      {s.active ? 'Ativo' : 'Inativo'}
                    </StatusPill>
                  </td>
                  <td className="row-actions">
                    <button type="button" className="btn btn-ghost" onClick={() => openEdit(s)}>
                      Editar
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => void showPurchases(s)}>
                      Compras
                    </button>
                    {s.active ? (
                      <button type="button" className="btn btn-danger" onClick={() => void inactivate(s)}>
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
            <p className="cart-empty">Selecione um fornecedor e clique em Compras.</p>
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
                {history.map((p) => (
                  <tr key={p.id}>
                    <td>{p.purchase_number}</td>
                    <td>{p.purchase_date}</td>
                    <td>{p.status}</td>
                    <td>{formatBRL(p.total_cents)}</td>
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
            <h3>{editing ? 'Editar fornecedor' : 'Novo fornecedor'}</h3>
            <div className="form-grid">
              <label className="span-2">
                Razão social *
                <input className="field-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label className="span-2">
                Nome fantasia
                <input className="field-input" value={form.trade_name} onChange={(e) => setForm({ ...form, trade_name: e.target.value })} />
              </label>
              <label>
                CPF/CNPJ
                <input className="field-input" value={form.document} onChange={(e) => setForm({ ...form, document: e.target.value })} />
              </label>
              <label>
                Contato responsável
                <input className="field-input" value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
              </label>
              <label>
                Telefone
                <input className="field-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </label>
              <label>
                WhatsApp
                <input className="field-input" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
              </label>
              <label className="span-2">
                E-mail
                <input className="field-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
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
              <label>
                CEP
                <input className="field-input" value={form.zip_code} onChange={(e) => setForm({ ...form, zip_code: e.target.value })} />
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
