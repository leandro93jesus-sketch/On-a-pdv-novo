import { useEffect, useState } from 'react';
import {
  createProduct,
  deleteProduct,
  fetchDuplicateProducts,
  fetchProducts,
  formatBRL,
  getStoredAuthUser,
  mergeProductsApi,
  parseBRLToCents,
  previewMergeApi,
  reviewDuplicateApi,
  updateProduct,
  type DuplicateCandidate,
  type Product,
} from '../../api/client';
import { ModuleToolbar, StatusPill } from '../../components/ModuleChrome';
import StockAdjustModal from '../estoque/StockAdjustModal';

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
  const me = getStoredAuthUser();
  const isAdmin = me?.role === 'administrador';
  const [items, setItems] = useState<Product[]>([]);
  const [q, setQ] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Product | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [confirmSimilar, setConfirmSimilar] = useState(false);
  const [similarHint, setSimilarHint] = useState<string | null>(null);

  const [showDupes, setShowDupes] = useState(false);
  const [dupes, setDupes] = useState<DuplicateCandidate[]>([]);
  const [dupeTotals, setDupeTotals] = useState<Record<string, unknown> | null>(null);
  const [mergePreview, setMergePreview] = useState<null | {
    candidate: DuplicateCandidate;
    primaryId: number;
    secondaryId: number;
    stock_rule: 'sum' | 'keep_primary' | 'keep_secondary';
    data: Awaited<ReturnType<typeof previewMergeApi>>;
  }>(null);
  const [mergeConfirm, setMergeConfirm] = useState(false);
  const [showStockAdjust, setShowStockAdjust] = useState(false);
  const [adjustProduct, setAdjustProduct] = useState<Product | null>(null);

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
      void load();
    }, 200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, includeInactive]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setConfirmSimilar(false);
    setSimilarHint(null);
    setShowForm(true);
  }

  function openEdit(p: Product) {
    setEditing(p);
    setConfirmSimilar(false);
    setSimilarHint(null);
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
        confirm_similar_name: confirmSimilar,
        ...(editing ? {} : { stock_qty: Number(form.stock_qty) || 0 }),
      };
      if (editing) await updateProduct(editing.id, payload);
      else await createProduct(payload);
      setShowForm(false);
      setNotice(editing ? 'Produto atualizado.' : 'Produto cadastrado.');
      await load();
    } catch (e) {
      const err = e as Error & { code?: string; details?: { similar?: Array<{ name: string }> } };
      if (err.code === 'SIMILAR_NAME') {
        const names = (err.details?.similar || []).map((s) => s.name).slice(0, 3).join(', ');
        setSimilarHint(names ? `Possíveis duplicados: ${names}` : 'Nome semelhante detectado.');
        setError('Nome semelhante encontrado. Confirme abaixo para continuar.');
      } else {
        setError(err.message || 'Erro ao salvar');
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: Product) {
    if (!window.confirm(`Excluir ou inativar "${p.name}"?`)) return;
    try {
      const result = await deleteProduct(p.id);
      setNotice(
        result.inactivated ? 'Produto inativado (possui histórico).' : 'Produto excluído.'
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao remover');
    }
  }

  async function openDuplicates() {
    if (!isAdmin) {
      setError('Somente administrador pode verificar duplicados.');
      return;
    }
    setError(null);
    try {
      const res = await fetchDuplicateProducts(includeInactive);
      setDupes(res.candidates);
      setDupeTotals(res.totals);
      setShowDupes(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao verificar duplicados');
    }
  }

  async function markReview(c: DuplicateCandidate, status: 'not_duplicate' | 'review') {
    try {
      await reviewDuplicateApi({
        product_a_id: c.product_a_id,
        product_b_id: c.product_b_id,
        match_type: c.match_type,
        status,
      });
      setNotice(status === 'not_duplicate' ? 'Marcado como não duplicado.' : 'Marcado para revisão.');
      const res = await fetchDuplicateProducts(includeInactive);
      setDupes(res.candidates);
      setDupeTotals(res.totals);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro na revisão');
    }
  }

  async function openMerge(c: DuplicateCandidate, primaryId: number, secondaryId: number) {
    try {
      const data = await previewMergeApi(primaryId, secondaryId);
      setMergePreview({
        candidate: c,
        primaryId,
        secondaryId,
        stock_rule: 'sum',
        data,
      });
      setMergeConfirm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro na prévia de mesclagem');
    }
  }

  async function runMerge() {
    if (!mergePreview || !mergeConfirm) {
      setError('Confirme a mesclagem.');
      return;
    }
    try {
      await mergeProductsApi({
        primary_id: mergePreview.primaryId,
        secondary_id: mergePreview.secondaryId,
        stock_rule: mergePreview.stock_rule,
        confirm: true,
      });
      setNotice('Produtos mesclados com sucesso.');
      setMergePreview(null);
      const res = await fetchDuplicateProducts(includeInactive);
      setDupes(res.candidates);
      setDupeTotals(res.totals);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao mesclar');
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
        <button type="button" className="btn btn-ghost" onClick={() => void openDuplicates()}>
          Verificar duplicados
        </button>
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
                <td
                  className={
                    p.stock_qty <= (p.min_stock_qty ?? 0) ? 'stock stock-low' : 'stock stock-ok'
                  }
                >
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
                <input
                  className="field-input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label>
                Código interno
                <input
                  className="field-input"
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                />
              </label>
              <label>
                Código de barras
                <input
                  className="field-input"
                  value={form.barcode}
                  onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                />
              </label>
              <label>
                Categoria
                <input
                  className="field-input"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                />
              </label>
              <label>
                Unidade
                <input
                  className="field-input"
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                />
              </label>
              <label>
                Preço de venda (R$)
                <input
                  className="field-input"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </label>
              <label>
                Preço de custo (R$)
                <input
                  className="field-input"
                  value={form.cost}
                  onChange={(e) => setForm({ ...form, cost: e.target.value })}
                />
              </label>
              {!editing && (
                <label>
                  Estoque inicial
                  <input
                    className="field-input"
                    value={form.stock_qty}
                    onChange={(e) => setForm({ ...form, stock_qty: e.target.value })}
                    inputMode="numeric"
                  />
                  <span className="field-hint">
                    Saldo inicial do produto (gera movimentação &quot;Estoque inicial&quot;).
                  </span>
                </label>
              )}
              {editing && (
                <div className="span-2 stock-edit-panel">
                  <div className="stock-edit-row">
                    <div>
                      <div className="stock-edit-label">Estoque atual</div>
                      <div className="stock-edit-value">
                        {editing.stock_qty} {editing.unit || 'UN'}
                      </div>
                      <div className="field-hint">
                        Saldo real do produto. Não confundir com estoque mínimo.
                      </div>
                    </div>
                    <div>
                      <div className="stock-edit-label">Estoque mínimo</div>
                      <input
                        className="field-input"
                        value={form.min_stock_qty}
                        onChange={(e) => setForm({ ...form, min_stock_qty: e.target.value })}
                        inputMode="numeric"
                      />
                      <div className="field-hint">Alerta quando o saldo ficar neste nível ou abaixo.</div>
                    </div>
                    {isAdmin && (
                      <div className="stock-edit-actions">
                        <button
                          type="button"
                          className="btn btn-accent"
                          onClick={() => {
                            setAdjustProduct(editing);
                            setShowStockAdjust(true);
                          }}
                        >
                          Ajustar estoque
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {!editing && (
                <label>
                  Estoque mínimo
                  <input
                    className="field-input"
                    value={form.min_stock_qty}
                    onChange={(e) => setForm({ ...form, min_stock_qty: e.target.value })}
                    inputMode="numeric"
                  />
                </label>
              )}
              <label className="span-2">
                Observações
                <input
                  className="field-input"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </label>
              <label className="check-inline">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                />
                Ativo
              </label>
              {(similarHint || confirmSimilar) && (
                <label className="check-inline span-2">
                  <input
                    type="checkbox"
                    checked={confirmSimilar}
                    onChange={(e) => setConfirmSimilar(e.target.checked)}
                  />
                  Confirmo cadastro mesmo com nome semelhante
                  {similarHint ? ` (${similarHint})` : ''}
                </label>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving}
                onClick={() => void save()}
              >
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDupes && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal modal-wide" style={{ width: 'min(960px, 100%)' }}>
            <h3>Verificar duplicados</h3>
            <p className="muted-line">
              Nunca apaga automaticamente. Abertos:{' '}
              {String((dupeTotals as { open?: number } | null)?.open ?? dupes.length)}
            </p>
            <div className="product-table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
              <table className="product-table">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Produto A</th>
                    <th>Produto B</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {dupes.map((c) => (
                    <tr key={`${c.product_a_id}-${c.product_b_id}-${c.match_type}`}>
                      <td>
                        <StatusPill tone={c.match_type.includes('name') ? 'warn' : 'danger'}>
                          {c.label}
                        </StatusPill>
                      </td>
                      <td>
                        <strong>{c.product_a.name}</strong>
                        <div className="muted-line">
                          #{c.product_a.id} · {c.product_a.sku || '—'} · {c.product_a.barcode || '—'}
                        </div>
                        <div className="muted-line">
                          {formatBRL(c.product_a.price_cents)} · est. {c.product_a.stock_qty} · vendas{' '}
                          {c.product_a.sales_count ?? 0}
                        </div>
                      </td>
                      <td>
                        <strong>{c.product_b.name}</strong>
                        <div className="muted-line">
                          #{c.product_b.id} · {c.product_b.sku || '—'} · {c.product_b.barcode || '—'}
                        </div>
                        <div className="muted-line">
                          {formatBRL(c.product_b.price_cents)} · est. {c.product_b.stock_qty} · vendas{' '}
                          {c.product_b.sales_count ?? 0}
                        </div>
                      </td>
                      <td className="row-actions" style={{ flexDirection: 'column', gap: 6 }}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => void markReview(c, 'not_duplicate')}
                        >
                          Não é duplicado
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => void markReview(c, 'review')}
                        >
                          Revisar
                        </button>
                        <button
                          type="button"
                          className="btn btn-accent"
                          onClick={() => void openMerge(c, c.product_a_id, c.product_b_id)}
                        >
                          Mesclar (A principal)
                        </button>
                        <button
                          type="button"
                          className="btn btn-accent"
                          onClick={() => void openMerge(c, c.product_b_id, c.product_a_id)}
                        >
                          Mesclar (B principal)
                        </button>
                      </td>
                    </tr>
                  ))}
                  {dupes.length === 0 && (
                    <tr>
                      <td colSpan={4}>Nenhuma possível duplicidade pendente.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowDupes(false)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {showStockAdjust && adjustProduct && (
        <StockAdjustModal
          product={adjustProduct}
          onClose={() => {
            setShowStockAdjust(false);
            setAdjustProduct(null);
          }}
          onDone={async (result) => {
            setShowStockAdjust(false);
            setAdjustProduct(null);
            setNotice(
              `Estoque ajustado: ${result.stock_before} → ${result.stock_after}`
            );
            await load();
            if (editing && editing.id === result.product_id) {
              setEditing({
                ...editing,
                stock_qty: result.stock_after,
              });
              setForm((f) => ({ ...f, stock_qty: String(result.stock_after) }));
            }
          }}
          onError={(msg) => setError(msg)}
        />
      )}

      {mergePreview && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal modal-wide">
            <h3>Mesclar produtos</h3>
            <pre className="code-block">{JSON.stringify(mergePreview.data, null, 2)}</pre>
            <label>
              Regra de estoque
              <select
                className="field-input"
                value={mergePreview.stock_rule}
                onChange={(e) =>
                  setMergePreview({
                    ...mergePreview,
                    stock_rule: e.target.value as 'sum' | 'keep_primary' | 'keep_secondary',
                  })
                }
              >
                <option value="sum">
                  Somar ({mergePreview.data.stock_rules.sum})
                </option>
                <option value="keep_primary">
                  Manter principal ({mergePreview.data.stock_rules.keep_primary})
                </option>
                <option value="keep_secondary">
                  Manter secundário ({mergePreview.data.stock_rules.keep_secondary})
                </option>
              </select>
            </label>
            <label className="check-inline" style={{ marginTop: 12 }}>
              <input
                type="checkbox"
                checked={mergeConfirm}
                onChange={(e) => setMergeConfirm(e.target.checked)}
              />
              Confirmo a mesclagem (transaction + auditoria; secundário será inativado)
            </label>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setMergePreview(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={!mergeConfirm}
                onClick={() => void runMerge()}
              >
                Mesclar agora
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
