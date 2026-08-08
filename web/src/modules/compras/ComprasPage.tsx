import { useEffect, useMemo, useState } from 'react';
import {
  cancelPurchase,
  completePurchase,
  createPurchase,
  fetchProducts,
  fetchPurchases,
  fetchSuppliers,
  formatBRL,
  parseBRLToCents,
  type Product,
  type Purchase,
  type Supplier,
} from '../../api/client';
import { ModuleToolbar, StatusPill } from '../../components/ModuleChrome';

type DraftItem = {
  key: string;
  product_id: number;
  product_name: string;
  quantity: number;
  unit_cost_input: string;
  discount_input: string;
};

function statusTone(status: string): 'ok' | 'warn' | 'danger' | 'muted' | 'info' {
  if (status === 'completed') return 'ok';
  if (status === 'draft') return 'warn';
  if (status === 'cancelled') return 'danger';
  return 'muted';
}

export default function ComprasPage() {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [supplierId, setSupplierId] = useState<number | ''>('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [discountInput, setDiscountInput] = useState('0,00');
  const [freightInput, setFreightInput] = useState('0,00');
  const [otherInput, setOtherInput] = useState('0,00');
  const [notes, setNotes] = useState('');
  const [asDraft, setAsDraft] = useState(false);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [productQuery, setProductQuery] = useState('');

  async function load() {
    try {
      const [p, s] = await Promise.all([
        fetchPurchases({ status: statusFilter || undefined }),
        fetchSuppliers(),
      ]);
      setPurchases(p);
      setSuppliers(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar compras');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void fetchProducts({ q: productQuery.trim() || undefined })
        .then(setProducts)
        .catch(() => undefined);
    }, 200);
    return () => window.clearTimeout(t);
  }, [productQuery]);

  const subtotal = useMemo(
    () =>
      items.reduce((sum, item) => {
        const unit = parseBRLToCents(item.unit_cost_input) ?? 0;
        const disc = parseBRLToCents(item.discount_input) ?? 0;
        return sum + unit * item.quantity - disc;
      }, 0),
    [items]
  );
  const discount = parseBRLToCents(discountInput) ?? 0;
  const freight = parseBRLToCents(freightInput) ?? 0;
  const other = parseBRLToCents(otherInput) ?? 0;
  const total = Math.max(subtotal - discount, 0) + freight + other;

  function addProduct(p: Product) {
    setItems((prev) => {
      const existing = prev.find((i) => i.product_id === p.id);
      if (existing) {
        return prev.map((i) =>
          i.product_id === p.id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [
        ...prev,
        {
          key: `p-${p.id}-${Date.now()}`,
          product_id: p.id,
          product_name: p.name,
          quantity: 1,
          unit_cost_input: (p.cost_cents / 100).toFixed(2).replace('.', ','),
          discount_input: '0,00',
        },
      ];
    });
  }

  async function submit() {
    if (!supplierId) {
      setError('Selecione o fornecedor');
      return;
    }
    if (items.length === 0) {
      setError('Adicione ao menos um produto');
      return;
    }
    try {
      const purchase = await createPurchase({
        supplier_id: supplierId,
        document_number: documentNumber.trim() || null,
        purchase_date: purchaseDate,
        discount_cents: discount,
        freight_cents: freight,
        other_costs_cents: other,
        notes: notes.trim() || null,
        status: asDraft ? 'draft' : 'completed',
        items: items.map((i) => ({
          product_id: i.product_id,
          quantity: i.quantity,
          unit_cost_cents: parseBRLToCents(i.unit_cost_input) ?? 0,
          discount_cents: parseBRLToCents(i.discount_input) ?? 0,
        })),
      });
      setShowForm(false);
      setItems([]);
      setNotice(
        purchase.status === 'draft'
          ? `Rascunho ${purchase.purchase_number} salvo.`
          : `Compra ${purchase.purchase_number} concluída. Estoque atualizado.`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar compra');
    }
  }

  async function handleCancel(p: Purchase) {
    const reason = window.prompt('Motivo do cancelamento (obrigatório):');
    if (reason == null) return;
    if (!reason.trim()) {
      setError('Informe o motivo do cancelamento.');
      return;
    }
    try {
      await cancelPurchase(p.id, reason.trim());
      setNotice(`Compra ${p.purchase_number} cancelada.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao cancelar');
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
          <option value="">Todos os status</option>
          <option value="draft">Rascunho</option>
          <option value="completed">Concluída</option>
          <option value="cancelled">Cancelada</option>
        </select>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setShowForm(true);
            setError(null);
          }}
        >
          Nova compra
        </button>
      </ModuleToolbar>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}

      <div className="product-table-wrap">
        <table className="product-table">
          <thead>
            <tr>
              <th>Número</th>
              <th>Fornecedor</th>
              <th>Data</th>
              <th>Nota</th>
              <th>Status</th>
              <th>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {purchases.map((p) => (
              <tr key={p.id}>
                <td>{p.purchase_number}</td>
                <td>{p.supplier_name || p.supplier_id}</td>
                <td>{p.purchase_date}</td>
                <td>{p.document_number || '—'}</td>
                <td>
                  <StatusPill tone={statusTone(p.status)}>{p.status}</StatusPill>
                </td>
                <td>{formatBRL(p.total_cents)}</td>
                <td className="row-actions">
                  {p.status === 'draft' ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() =>
                        void completePurchase(p.id)
                          .then(async () => {
                            setNotice(`Compra ${p.purchase_number} concluída.`);
                            await load();
                          })
                          .catch((e: Error) => setError(e.message))
                      }
                    >
                      Concluir
                    </button>
                  ) : null}
                  {p.status !== 'cancelled' ? (
                    <button type="button" className="btn btn-danger" onClick={() => void handleCancel(p)}>
                      Cancelar
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {purchases.length === 0 && (
              <tr>
                <td colSpan={7}>Nenhuma compra encontrada.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="modal-backdrop">
          <div className="modal modal-wide">
            <h3>Nova compra</h3>
            <div className="form-grid">
              <label className="span-2">
                Fornecedor *
                <select
                  className="field-input"
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">Selecione…</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Nº nota/documento
                <input className="field-input" value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} />
              </label>
              <label>
                Data da compra
                <input className="field-input" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
              </label>
              <label>
                Desconto
                <input className="field-input" value={discountInput} onChange={(e) => setDiscountInput(e.target.value)} />
              </label>
              <label>
                Frete
                <input className="field-input" value={freightInput} onChange={(e) => setFreightInput(e.target.value)} />
              </label>
              <label>
                Outras despesas
                <input className="field-input" value={otherInput} onChange={(e) => setOtherInput(e.target.value)} />
              </label>
              <label className="span-2">
                Observações
                <input className="field-input" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </label>
              <label className="check-inline span-2">
                <input type="checkbox" checked={asDraft} onChange={(e) => setAsDraft(e.target.checked)} />
                Salvar como rascunho (não atualiza estoque)
              </label>
            </div>

            <div className="module-toolbar" style={{ marginTop: '0.75rem' }}>
              <input
                className="search-input"
                placeholder="Buscar produto para adicionar…"
                value={productQuery}
                onChange={(e) => setProductQuery(e.target.value)}
              />
            </div>
            <div className="product-table-wrap" style={{ maxHeight: 160, overflow: 'auto' }}>
              <table className="product-table">
                <tbody>
                  {products.slice(0, 8).map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>{formatBRL(p.cost_cents)}</td>
                      <td>
                        <button type="button" className="btn btn-ghost" onClick={() => addProduct(p)}>
                          Adicionar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <table className="product-table" style={{ marginTop: '0.75rem' }}>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Qtd</th>
                  <th>Custo unit.</th>
                  <th>Desc.</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.key}>
                    <td>{item.product_name}</td>
                    <td>
                      <input
                        className="field-input"
                        style={{ width: 70 }}
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((i) =>
                              i.key === item.key
                                ? { ...i, quantity: Math.max(1, Number(e.target.value) || 1) }
                                : i
                            )
                          )
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="field-input"
                        style={{ width: 100 }}
                        value={item.unit_cost_input}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((i) =>
                              i.key === item.key ? { ...i, unit_cost_input: e.target.value } : i
                            )
                          )
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="field-input"
                        style={{ width: 90 }}
                        value={item.discount_input}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((i) =>
                              i.key === item.key ? { ...i, discount_input: e.target.value } : i
                            )
                          )
                        }
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setItems((prev) => prev.filter((i) => i.key !== item.key))}
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p style={{ marginTop: '0.75rem' }}>
              Subtotal {formatBRL(subtotal)} · Total {formatBRL(total)}
            </p>

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>
                Fechar
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void submit()}>
                {asDraft ? 'Salvar rascunho' : 'Concluir compra'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
