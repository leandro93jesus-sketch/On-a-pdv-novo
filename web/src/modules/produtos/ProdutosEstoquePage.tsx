import { useEffect, useState } from 'react';
import {
  createProduct,
  fetchProducts,
  fetchStockMovements,
  formatBRL,
  getStoredAuthUser,
  parseBRLToCents,
  updateProduct,
  type Product,
  type StockMovement,
} from '../../api/client';
import { ModuleToolbar, StatusPill } from '../../components/ModuleChrome';
import StockAdjustModal, { type AdjustMode } from '../estoque/StockAdjustModal';

/**
 * Área única PRODUTOS / ESTOQUE — cadastro + saldos + ajustes em uma tela.
 */
export default function ProdutosEstoquePage() {
  const me = getStoredAuthUser();
  const canAdjust = me?.role === 'administrador' || me?.role === 'gerente' || true;
  const [items, setItems] = useState<Product[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);

  const [editing, setEditing] = useState<Product | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    barcode: '',
    sku: '',
    category: 'Geral',
    price: '0,00',
    cost: '0,00',
    stock_qty: '0',
    min_stock_qty: '0',
    active: true,
  });
  const [saving, setSaving] = useState(false);

  const [adjustProduct, setAdjustProduct] = useState<Product | null>(null);
  const [adjustMode, setAdjustMode] = useState<AdjustMode>('entry');
  const [showAdjust, setShowAdjust] = useState(false);
  const [showMovements, setShowMovements] = useState(false);

  async function load() {
    try {
      const list = await fetchProducts({
        q: q.trim() || undefined,
        include_inactive: includeInactive,
      });
      setItems(list);
      if (showMovements) {
        const movs = await fetchStockMovements({ limit: 40 });
        setMovements(movs);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar produtos/estoque');
    }
  }

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, includeInactive, showMovements]);

  function openCreate() {
    setEditing(null);
    setForm({
      name: '',
      barcode: '',
      sku: '',
      category: 'Geral',
      price: '0,00',
      cost: '0,00',
      stock_qty: '0',
      min_stock_qty: '0',
      active: true,
    });
    setShowForm(true);
  }

  function openEdit(p: Product) {
    setEditing(p);
    setForm({
      name: p.name,
      barcode: p.barcode || '',
      sku: p.sku || '',
      category: p.category || 'Geral',
      price: (p.price_cents / 100).toFixed(2).replace('.', ','),
      cost: (p.cost_cents / 100).toFixed(2).replace('.', ','),
      stock_qty: String(p.stock_qty ?? 0),
      min_stock_qty: String(p.min_stock_qty ?? 0),
      active: p.active !== 0,
    });
    setShowForm(true);
  }

  function openAdjust(p: Product, mode: AdjustMode) {
    if (!canAdjust) {
      setError('Sem permissão para ajustar estoque.');
      return;
    }
    setAdjustProduct(p);
    setAdjustMode(mode);
    setShowAdjust(true);
  }

  async function saveForm() {
    const price = parseBRLToCents(form.price);
    const cost = parseBRLToCents(form.cost);
    if (!form.name.trim()) {
      setError('Nome obrigatório.');
      return;
    }
    if (price == null || cost == null) {
      setError('Preços inválidos.');
      return;
    }
    const stock_qty = Number(form.stock_qty);
    const min_stock_qty = Number(form.min_stock_qty);
    if (!Number.isFinite(stock_qty) || !Number.isFinite(min_stock_qty)) {
      setError('Estoque inválido.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        barcode: form.barcode.trim() || null,
        sku: form.sku.trim() || null,
        category: form.category.trim() || 'Geral',
        price_cents: price,
        cost_cents: cost,
        stock_qty: Math.trunc(stock_qty),
        min_stock_qty: Math.trunc(min_stock_qty),
        active: form.active,
        confirm_similar_name: true,
      };
      if (editing) {
        await updateProduct(editing.id, payload);
        setNotice(`Produto "${payload.name}" atualizado.`);
      } else {
        await createProduct(payload);
        setNotice(`Produto "${payload.name}" cadastrado.`);
      }
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }

  function statusOf(p: Product): { label: string; tone: 'ok' | 'warn' | 'danger' | 'muted' } {
    if (p.active === 0) return { label: 'Inativo', tone: 'muted' };
    const min = p.min_stock_qty ?? 0;
    if (p.stock_qty <= 0) return { label: 'Sem estoque', tone: 'danger' };
    if (p.stock_qty <= min) return { label: 'Baixo', tone: 'warn' };
    return { label: 'OK', tone: 'ok' };
  }

  return (
    <section className="module-panel">
      <ModuleToolbar>
        <input
          className="field-input"
          placeholder="Buscar por nome, código de barras ou categoria…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 280 }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          Atualizar
        </button>
      </ModuleToolbar>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}

      <p className="muted-line">
        Lista enxuta para o balcão. Custo, mínimo e movimentações ficam no editar / mais detalhes.
      </p>

      <div className="table-wrap">
        <table className="product-table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Produto</th>
              <th>Preço</th>
              <th>Estoque</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => {
              const st = statusOf(p);
              return (
                <tr key={p.id}>
                  <td>{p.barcode || '—'}</td>
                  <td>
                    <strong>{p.name}</strong>
                  </td>
                  <td>{formatBRL(p.price_cents)}</td>
                  <td>
                    <strong>{p.stock_qty}</strong>
                  </td>
                  <td>
                    <StatusPill tone={st.tone}>{st.label}</StatusPill>
                  </td>
                  <td className="row-actions">
                    <button type="button" className="btn btn-ghost" onClick={() => openEdit(p)}>
                      Editar
                    </button>
                    {canAdjust ? (
                      <button
                        type="button"
                        className="btn btn-accent"
                        onClick={() => openAdjust(p, 'entry')}
                      >
                        Ajustar
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={6}>Nenhum produto encontrado.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setShowMovements((v) => !v)}
        >
          {showMovements ? 'Ocultar movimentações' : 'Mais detalhes — movimentações'}
        </button>
      </div>

      {showMovements ? (
        <>
          <h3 style={{ marginTop: 12 }}>Últimas movimentações</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data/hora</th>
                  <th>Produto</th>
                  <th>Tipo</th>
                  <th>Antes</th>
                  <th>Depois</th>
                  <th>Diferença</th>
                  <th>Motivo</th>
                  <th>Usuário</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td>{m.created_at}</td>
                    <td>{m.product_name || m.product_id}</td>
                    <td>{m.movement_type}</td>
                    <td>{m.stock_before ?? '—'}</td>
                    <td>{m.stock_after ?? '—'}</td>
                    <td>
                      {m.quantity_delta > 0 ? `+${m.quantity_delta}` : String(m.quantity_delta)}
                    </td>
                    <td>{m.reason || m.note || '—'}</td>
                    <td>{m.user_name || '—'}</td>
                  </tr>
                ))}
                {movements.length === 0 && (
                  <tr>
                    <td colSpan={8}>Sem movimentações recentes.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {showForm && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal modal-wide">
            <h3>{editing ? 'Editar produto' : 'Novo produto'}</h3>
            <div className="modal-fields">
              <label>
                Nome *
                <input
                  className="field-input"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>
              <label>
                Código de barras
                <input
                  className="field-input"
                  value={form.barcode}
                  onChange={(e) => setForm((f) => ({ ...f, barcode: e.target.value }))}
                />
              </label>
              <label>
                Código interno (SKU)
                <input
                  className="field-input"
                  value={form.sku}
                  onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                />
              </label>
              <label>
                Categoria
                <input
                  className="field-input"
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                />
              </label>
              <label>
                Preço de custo
                <input
                  className="field-input"
                  value={form.cost}
                  onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))}
                />
              </label>
              <label>
                Preço de venda
                <input
                  className="field-input"
                  value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                />
              </label>
              <label>
                Estoque atual
                <input
                  className="field-input"
                  value={form.stock_qty}
                  onChange={(e) => setForm((f) => ({ ...f, stock_qty: e.target.value }))}
                  disabled={Boolean(editing)}
                />
              </label>
              <label>
                Estoque mínimo
                <input
                  className="field-input"
                  value={form.min_stock_qty}
                  onChange={(e) => setForm((f) => ({ ...f, min_stock_qty: e.target.value }))}
                />
              </label>
              {editing ? (
                <p className="muted-line span-2">
                  Para alterar quantidade use + Entrada ou − Saída/Ajuste (gera movimentação).
                </p>
              ) : null}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving}
                onClick={() => void saveForm()}
              >
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAdjust && adjustProduct && (
        <StockAdjustModal
          product={adjustProduct}
          initialMode={adjustMode}
          onClose={() => {
            setShowAdjust(false);
            setAdjustProduct(null);
          }}
          onDone={(r) => {
            setShowAdjust(false);
            setAdjustProduct(null);
            setNotice(
              `Estoque atualizado: ${r.stock_before} → ${r.stock_after} (${r.mode === 'entry' ? 'entrada' : r.mode === 'exit' ? 'saída' : 'ajuste'})`
            );
            void load();
          }}
          onError={(msg) => setError(msg)}
        />
      )}
    </section>
  );
}
