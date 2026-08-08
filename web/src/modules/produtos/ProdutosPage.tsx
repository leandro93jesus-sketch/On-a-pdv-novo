import { useEffect, useState } from 'react';
import {
  createProduct,
  deleteProduct,
  fetchProducts,
  formatBRL,
  parseBRLToCents,
  updateProduct,
  type Product,
} from '../../api/client';
import { ModuleToolbar, StatusPill } from '../../components/ModuleChrome';

const emptyForm = {
  name: '',
  sku: '',
  barcode: '',
  category: 'Geral',
  unit: 'UN',
  price: '0,00',
  cost: '0,00',
  stock_qty: '0',
  min_stock_qty: '0',
  notes: '',
  active: true,
};

export default function ProdutosPage() {
  const [items, setItems] = useState<Product[]>([]);
  const [q, setQ] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Product | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const list = await fetchProducts({ q: q.trim() || undefined, include_inactive: includeInactive });
      setItems(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar produtos');
    }
  }

  useEffect(() => {
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const list = await fetchProducts({
            q: q.trim() || undefined,
            include_inactive: includeInactive,
          });
          setItems(list);
          setError(null);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Erro ao carregar produtos');
        }
      })();
    }, 200);
    return () => window.clearTimeout(t);
  }, [q, includeInactive]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function openEdit(p: Product) {
    setEditing(p);
    setForm({
      name: p.name,
      sku: p.sku || '',
      barcode: p.barcode || '',
      category: p.category || 'Geral',
      unit: p.unit || 'UN',
      price: (p.price_cents / 100).toFixed(2).replace('.', ','),
      cost: (p.cost_cents / 100).toFixed(2).replace('.', ','),
      stock_qty: String(p.stock_qty),
      min_stock_qty: String(p.min_stock_qty ?? 0),
      notes: p.notes || '',
      active: Boolean(p.active),
    });
    setShowForm(true);
  }

  async function save() {
    const price = parseBRLToCents(form.price);
    const cost = parseBRLToCents(form.cost);
    if (!form.name.trim()) {
      setError('Nome é obrigatório');
      return;
    }
    if (price == null || cost == null) {
      setError('Preços inválidos');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: form.name.trim(),
        sku: form.sku.trim() || null,
        barcode: form.barcode.trim() || null,
        category: form.category.trim() || 'Geral',
        unit: form.unit.trim() || 'UN',
        price_cents: price,
        cost_cents: cost,
        min_stock_qty: Number(form.min_stock_qty) || 0,
        notes: form.notes.trim() || null,
        active: form.active,
        ...(editing ? {} : { stock_qty: Number(form.stock_qty) || 0 }),
      };
      if (editing) await updateProduct(editing.id, payload);
      else await createProduct(payload);
      setShowForm(false);
      setNotice(editing ? 'Produto atualizado.' : 'Produto cadastrado.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: Product) {
    if (!window.confirm(`Excluir ou inativar "${p.name}"?`)) return;
    try {
      const result = await deleteProduct(p.id);
      setNotice(
        result.inactivated
          ? 'Produto inativado (possui histórico).'
          : 'Produto excluído.'
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao remover');
    }
  }

  return (
    <section className="module-panel">
      <ModuleToolbar>
        <input
          className="search-input"
          placeholder="Buscar por nome, código ou código de barras…"
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
          Novo produto
        </button>
      </ModuleToolbar>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}

      <div className="product-table-wrap">
        <table className="product-table">
          <thead>
            <tr>
              <th>Produto</th>
              <th>Código</th>
              <th>Barras</th>
              <th>Categoria</th>
              <th>Estoque</th>
              <th>Mín.</th>
              <th>Preço</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.sku || '—'}</td>
                <td>{p.barcode || '—'}</td>
                <td>{p.category}</td>
                <td className={p.stock_qty <= (p.min_stock_qty ?? 0) ? 'stock stock-low' : 'stock stock-ok'}>
                  {p.stock_qty} {p.unit || 'UN'}
                </td>
                <td>{p.min_stock_qty ?? 0}</td>
                <td className="price">{formatBRL(p.price_cents)}</td>
                <td>
                  <StatusPill tone={p.active ? 'ok' : 'muted'}>
                    {p.active ? 'Ativo' : 'Inativo'}
                  </StatusPill>
                </td>
                <td className="row-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => openEdit(p)}>
                    Editar
                  </button>
                  <button type="button" className="btn btn-danger" onClick={() => void remove(p)}>
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={9}>Nenhum produto encontrado.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal modal-wide">
            <h3>{editing ? 'Editar produto' : 'Novo produto'}</h3>
            <div className="form-grid">
              <label>
                Nome *
                <input className="field-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label>
                Código interno
                <input className="field-input" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
              </label>
              <label>
                Código de barras
                <input className="field-input" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
              </label>
              <label>
                Categoria
                <input className="field-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              </label>
              <label>
                Unidade
                <input className="field-input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
              </label>
              <label>
                Preço de venda (R$)
                <input className="field-input" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
              </label>
              <label>
                Preço de custo (R$)
                <input className="field-input" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
              </label>
              {!editing && (
                <label>
                  Estoque inicial
                  <input className="field-input" value={form.stock_qty} onChange={(e) => setForm({ ...form, stock_qty: e.target.value })} />
                </label>
              )}
              <label>
                Estoque mínimo
                <input className="field-input" value={form.min_stock_qty} onChange={(e) => setForm({ ...form, min_stock_qty: e.target.value })} />
              </label>
              <label className="span-2">
                Observações
                <input className="field-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </label>
              <label className="check-inline">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                Ativo
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
