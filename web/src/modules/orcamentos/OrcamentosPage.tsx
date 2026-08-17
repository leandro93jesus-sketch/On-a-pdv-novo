import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  buildQuotePdfUrl,
  cancelQuoteApi,
  createQuoteApi,
  fetchProducts,
  fetchQuote,
  fetchQuoteConversionPayload,
  fetchQuotesPaged,
  formatBRL,
  generateQuotePdfApi,
  quoteWhatsappShareApi,
  updateQuoteApi,
  type Customer,
  type Product,
  type Quote,
  type ReceiptPdfMeta,
} from '../../api/client';
import CustomerPicker from '../vendas/CustomerPicker';
import MiscItemModal from '../vendas/MiscItemModal';
import {
  lineCode,
  lineTotal,
  miscLine,
  productToLine,
  type CartLine,
} from '../vendas/types';
import { savePdfToComputer } from '../../lib/savePdf';
import { emptyDeliveryAddress } from '../entregas/DeliveryAddressForm';
import { saveDraft, type SaleDraft } from '../vendas/saleDraftStore';
import { QUOTE_TO_SALE_KEY } from './quoteConversion';

const PAGE_SIZE = 100;

function looksLikeBarcode(term: string) {
  return /^[0-9]{8,18}$/.test(term.trim());
}

function parseDiscountInput(value: string): { ok: true; cents: number } | { ok: false; error: string } {
  const cleaned = value.trim().replace(/\./g, '').replace(',', '.');
  if (!cleaned) return { ok: true, cents: 0 };
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: 'Desconto inválido' };
  return { ok: true, cents: Math.round(n * 100) };
}

function defaultValidUntil() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

function centsToInput(cents: number) {
  return (cents / 100).toFixed(2).replace('.', ',');
}

type Mode = 'list' | 'edit';

export default function OrcamentosPage() {
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);
  const scanLockRef = useRef(false);

  const [mode, setMode] = useState<Mode>('list');
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState({
    q: '',
    status: '',
    from: '',
    to: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [quoteNumber, setQuoteNumber] = useState<string | null>(null);
  const [status, setStatus] = useState('aberto');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [phone, setPhone] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [validUntil, setValidUntil] = useState(defaultValidUntil());
  const [discountInput, setDiscountInput] = useState('0,00');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Product[]>([]);
  const [showMisc, setShowMisc] = useState(false);
  const [stockWarn, setStockWarn] = useState<string | null>(null);
  const [pdfMeta, setPdfMeta] = useState<ReceiptPdfMeta | null>(null);
  const [convertedSaleId, setConvertedSaleId] = useState<number | null>(null);

  const subtotal = useMemo(() => cart.reduce((s, l) => s + lineTotal(l), 0), [cart]);
  const discountParse = parseDiscountInput(discountInput);
  const discountCents = discountParse.ok ? Math.min(discountParse.cents, subtotal) : 0;
  const totalCents = Math.max(subtotal - discountCents, 0);
  const locked = ['convertido', 'cancelado', 'expirado'].includes(status);

  async function loadList(nextOffset = 0) {
    setBusy(true);
    try {
      const res = await fetchQuotesPaged({
        q: filters.q || undefined,
        status: filters.status || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
        limit: PAGE_SIZE,
        offset: nextOffset,
      });
      setQuotes(res.items);
      setTotal(res.total);
      setOffset(res.offset);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao listar orçamentos');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (mode === 'list') void loadList(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  function resetEditor() {
    setEditingId(null);
    setQuoteNumber(null);
    setStatus('aberto');
    setCustomer(null);
    setPhone('');
    setDocumentId('');
    setAddress('');
    setNotes('');
    setValidUntil(defaultValidUntil());
    setDiscountInput('0,00');
    setCart([]);
    setQuery('');
    setSuggestions([]);
    setPdfMeta(null);
    setConvertedSaleId(null);
    setStockWarn(null);
    setNotice(null);
    setError(null);
  }

  function startNew() {
    resetEditor();
    setMode('edit');
    window.setTimeout(() => searchRef.current?.focus(), 50);
  }

  async function openQuote(id: number) {
    setBusy(true);
    try {
      const q = await fetchQuote(id);
      setEditingId(q.id);
      setQuoteNumber(q.quote_number);
      setStatus(q.status);
      setConvertedSaleId(q.converted_sale_id ?? null);
      setCustomer(
        q.customer_id
          ? ({
              id: q.customer_id,
              name: q.customer_name || '',
              phone: q.customer_phone || '',
              whatsapp: q.customer_phone || '',
              document: q.customer_document || '',
            } as Customer)
          : null
      );
      setPhone(q.customer_phone || '');
      setDocumentId(q.customer_document || '');
      setAddress(q.customer_address || '');
      setNotes(q.notes || '');
      setValidUntil(q.valid_until || defaultValidUntil());
      setDiscountInput(centsToInput(q.discount_cents || 0));
      setCart(
        (q.items || []).map((it, idx) => ({
          key: it.product_id ? `p-${it.product_id}` : `m-${idx}-${it.name}`,
          productId: it.product_id,
          name: it.name,
          sku: it.sku ?? null,
          barcode: it.barcode ?? null,
          unitPriceCents: it.unit_price_cents,
          quantity: Number(it.quantity),
          discountCents: 0,
          isMisc: Boolean(it.is_misc),
          stockQty: null,
          allowNegative: true,
        }))
      );
      setMode('edit');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao abrir orçamento');
    } finally {
      setBusy(false);
    }
  }

  function addProduct(product: Product, qty = 1) {
    if (product.stock_qty != null && product.stock_qty <= 0) {
      setStockWarn(
        `ATENÇÃO: estoque insuficiente/zerado para "${product.name}" (disponível: ${product.stock_qty}). O orçamento NÃO baixa estoque.`
      );
    } else {
      setStockWarn(null);
    }
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      if (existing) {
        return prev.map((l) =>
          l.productId === product.id ? { ...l, quantity: l.quantity + qty } : l
        );
      }
      return [...prev, productToLine(product, qty)];
    });
    setQuery('');
    setSuggestions([]);
    searchRef.current?.focus();
  }

  async function handleSearchEnter() {
    const term = query.trim();
    if (!term || scanLockRef.current) return;
    if (looksLikeBarcode(term)) {
      scanLockRef.current = true;
      try {
        const found = await fetchProducts({ barcode: term });
        const exact = found.find((p) => String(p.barcode || '').trim() === term && p.active !== 0);
        if (exact) {
          addProduct(exact);
          return;
        }
        setError(`Código ${term} não encontrado`);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro na busca');
      } finally {
        scanLockRef.current = false;
      }
      return;
    }
    try {
      const found = await fetchProducts({ q: term });
      setSuggestions(found.filter((p) => p.active !== 0).slice(0, 12));
      if (found.length === 1) addProduct(found[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro na busca');
    }
  }

  useEffect(() => {
    if (mode !== 'edit') return;
    if (looksLikeBarcode(query)) {
      setSuggestions([]);
      return;
    }
    const term = query.trim();
    if (!term) {
      setSuggestions([]);
      return;
    }
    const t = window.setTimeout(async () => {
      try {
        const found = await fetchProducts({ q: term });
        setSuggestions(found.filter((p) => p.active !== 0).slice(0, 12));
      } catch {
        /* ignore */
      }
    }, 200);
    return () => window.clearTimeout(t);
  }, [query, mode]);

  function buildPayload() {
    if (!discountParse.ok) throw new Error(discountParse.error);
    if (cart.length === 0) throw new Error('Adicione ao menos um produto');
    return {
      customer_id: customer?.id ?? null,
      customer_name: customer?.name || null,
      customer_phone: phone || customer?.whatsapp || customer?.phone || null,
      customer_document: documentId || customer?.document || null,
      customer_address: address || null,
      notes: notes || null,
      valid_until: validUntil || null,
      discount_cents: discountCents,
      items: cart.map((l) => ({
        product_id: l.productId,
        name: l.name,
        sku: l.sku,
        barcode: l.barcode,
        quantity: l.quantity,
        unit_price_cents: l.unitPriceCents,
        is_misc: l.isMisc,
      })),
    };
  }

  async function saveQuote() {
    if (locked) {
      setError('Orçamento encerrado não pode ser editado');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = buildPayload();
      const saved = editingId
        ? await updateQuoteApi(editingId, payload)
        : await createQuoteApi(payload);
      setEditingId(saved.id);
      setQuoteNumber(saved.quote_number);
      setStatus(saved.status);
      setNotice(
        `Orçamento ${saved.quote_number} salvo. Estoque e caixa NÃO foram alterados.`
      );
      setPdfMeta(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar orçamento');
    } finally {
      setBusy(false);
    }
  }

  async function ensurePdf() {
    if (!editingId) throw new Error('Salve o orçamento antes de gerar o PDF');
    const meta = await generateQuotePdfApi(editingId, { force: true });
    setPdfMeta(meta);
    return meta;
  }

  async function viewPdf() {
    try {
      const meta = await ensurePdf();
      window.open(meta.view_url || buildQuotePdfUrl(editingId!), '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao gerar PDF');
    }
  }

  async function savePdfDisk() {
    try {
      const meta = await ensurePdf();
      const result = await savePdfToComputer({
        suggestedName: meta.filename || `ONCA-ORCAMENTO-${quoteNumber || editingId}.pdf`,
        downloadUrl: meta.download_url || buildQuotePdfUrl(editingId!, { download: true }),
        absolutePath: meta.absolute_path,
        title: 'Salvar orçamento em PDF',
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
        result.filePath
          ? `PDF salvo em: ${result.filePath}`
          : 'PDF enviado para download no computador.'
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar PDF');
    }
  }

  async function sendWhatsApp() {
    if (!editingId) {
      setError('Salve o orçamento antes');
      return;
    }
    try {
      const share = await quoteWhatsappShareApi(editingId, {
        phone: phone || undefined,
        force: true,
      });
      if (share.pdf) setPdfMeta(share.pdf);
      setNotice(share.note || 'PDF gerado. Anexe na conversa do WhatsApp.');
      window.open(share.pdf?.view_url || buildQuotePdfUrl(editingId), '_blank', 'noopener,noreferrer');
      window.setTimeout(() => window.open(share.url, '_blank', 'noopener,noreferrer'), 350);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro no WhatsApp');
    }
  }

  function printQuote() {
    window.print();
  }

  async function convertToSale() {
    if (!editingId) {
      setError('Salve o orçamento antes de converter');
      return;
    }
    try {
      const payload = await fetchQuoteConversionPayload(editingId);
      const draft: SaleDraft = {
        version: 1,
        updatedAt: new Date().toISOString(),
        saleMode: 'normal',
        cart: payload.items.map((it, idx) => ({
          key: it.product_id ? `p-${it.product_id}` : `m-q-${idx}`,
          productId: it.product_id,
          name: it.name,
          sku: it.sku ?? null,
          barcode: it.barcode ?? null,
          unitPriceCents: it.unit_price_cents,
          quantity: Number(it.quantity),
          discountCents: 0,
          isMisc: Boolean(it.is_misc),
          stockQty: null,
          allowNegative: true,
        })),
        customer: payload.customer_id
          ? ({
              id: payload.customer_id,
              name: payload.customer_name || '',
              phone: payload.customer_phone || '',
              whatsapp: payload.customer_phone || '',
            } as Customer)
          : null,
        discountInput: centsToInput(payload.discount_cents || 0),
        payment: 'dinheiro',
        cardType: null,
        cashReceivedInput: '',
        creditEntryInput: '0,00',
        creditInstallments: 1,
        creditFirstDue: new Date().toISOString().slice(0, 10),
        mixedDraft: null,
        deliveryAddr: emptyDeliveryAddress(),
      };
      saveDraft(draft);
      sessionStorage.setItem(
        QUOTE_TO_SALE_KEY,
        JSON.stringify({ quote_id: payload.quote_id, quote_number: payload.quote_number })
      );
      setNotice(
        `Itens do ${payload.quote_number} carregados em Vendas. Finalize a venda para baixar estoque/caixa.`
      );
      navigate('/vendas');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível converter');
    }
  }

  async function doCancel() {
    if (!editingId) return;
    const reason = window.prompt('Motivo do cancelamento do orçamento:');
    if (!reason?.trim()) return;
    try {
      const q = await cancelQuoteApi(editingId, reason.trim());
      setStatus(q.status);
      setNotice(`Orçamento ${q.quote_number} cancelado. Sem impacto em estoque/caixa.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao cancelar');
    }
  }

  if (mode === 'list') {
    return (
      <section className="module-panel">
        <div className="module-toolbar" style={{ gap: 12, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" onClick={startNew}>
            Novo orçamento
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => void loadList(0)} disabled={busy}>
            Atualizar histórico
          </button>
          <input
            className="field-input"
            placeholder="Buscar nº / cliente / telefone"
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void loadList(0);
            }}
          />
          <select
            className="field-input"
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
          >
            <option value="">Todos os status</option>
            <option value="aberto">Aberto</option>
            <option value="enviado">Enviado</option>
            <option value="aprovado">Aprovado</option>
            <option value="convertido">Convertido em venda</option>
            <option value="cancelado">Cancelado</option>
            <option value="expirado">Expirado</option>
          </select>
          <input
            className="field-input"
            type="date"
            value={filters.from}
            onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
          />
          <input
            className="field-input"
            type="date"
            value={filters.to}
            onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
          />
          <button type="button" className="btn btn-accent" onClick={() => void loadList(0)}>
            Filtrar
          </button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {notice && <div className="alert alert-ok">{notice}</div>}

        <p className="muted-line">
          Histórico de orçamentos — {total} registro(s). Orçamento não baixa estoque nem movimenta caixa.
        </p>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Número</th>
                <th>Data</th>
                <th>Cliente</th>
                <th>Total</th>
                <th>Validade</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.id}>
                  <td>{q.quote_number}</td>
                  <td>{q.created_at}</td>
                  <td>{q.customer_name || '—'}</td>
                  <td>{formatBRL(q.total_cents)}</td>
                  <td>{q.valid_until || '—'}</td>
                  <td>{q.status_label || q.status}</td>
                  <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-ghost" onClick={() => void openQuote(q.id)}>
                      Ver / Editar
                    </button>
                  </td>
                </tr>
              ))}
              {quotes.length === 0 && (
                <tr>
                  <td colSpan={7}>Nenhum orçamento encontrado.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="module-toolbar" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={offset <= 0 || busy}
            onClick={() => void loadList(Math.max(0, offset - PAGE_SIZE))}
          >
            Anterior
          </button>
          <span>
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} de {total}
          </span>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={offset + PAGE_SIZE >= total || busy}
            onClick={() => void loadList(offset + PAGE_SIZE)}
          >
            Próxima
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="module-panel">
      <div className="module-toolbar" style={{ gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setMode('list');
            void loadList(0);
          }}
        >
          ← Histórico de orçamentos
        </button>
        <strong>
          {quoteNumber ? `Orçamento ${quoteNumber}` : 'Novo orçamento'}
          {status ? ` · ${status}` : ''}
        </strong>
        {convertedSaleId ? <span>Convertido (venda id {convertedSaleId})</span> : null}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}
      {stockWarn && <div className="alert alert-error">{stockWarn}</div>}

      <div className="sale-layout" style={{ display: 'grid', gap: 16 }}>
        <div className="card-block" style={{ display: 'grid', gap: 10 }}>
          <CustomerPicker
            selected={customer}
            onSelect={(c) => {
              setCustomer(c);
              if (c) {
                setPhone(c.whatsapp || c.phone || '');
                setDocumentId(c.document || '');
                const addr = [c.address, c.address_number, c.neighborhood, c.city, c.state]
                  .filter(Boolean)
                  .join(', ');
                if (addr) setAddress(addr);
              }
            }}
          />
          {locked ? <p className="muted-line">Orçamento encerrado — edição bloqueada.</p> : null}          <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label>
              Telefone
              <input
                className="field-input"
                value={phone}
                disabled={locked}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
            <label>
              CPF/CNPJ
              <input
                className="field-input"
                value={documentId}
                disabled={locked}
                onChange={(e) => setDocumentId(e.target.value)}
              />
            </label>
            <label className="span-2" style={{ gridColumn: '1 / -1' }}>
              Endereço
              <input
                className="field-input"
                value={address}
                disabled={locked}
                onChange={(e) => setAddress(e.target.value)}
              />
            </label>
            <label>
              Validade
              <input
                className="field-input"
                type="date"
                value={validUntil}
                disabled={locked}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </label>
            <label>
              Desconto (R$)
              <input
                className="field-input"
                value={discountInput}
                disabled={locked}
                onChange={(e) => setDiscountInput(e.target.value)}
              />
            </label>
            <label className="span-2" style={{ gridColumn: '1 / -1' }}>
              Observação
              <textarea
                className="field-input"
                rows={2}
                value={notes}
                disabled={locked}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </div>
        </div>

        {!locked && (
          <div className="search-row">
            <input
              ref={searchRef}
              className="search-input"
              placeholder="Buscar produto ou ler código de barras…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleSearchEnter();
                }
              }}
            />
            <button type="button" className="btn btn-primary" onClick={() => void handleSearchEnter()}>
              Buscar
            </button>
            <button type="button" className="btn btn-accent" onClick={() => setShowMisc(true)}>
              Item Diversos
            </button>
          </div>
        )}

        {suggestions.length > 0 && !locked && (
          <div className="search-suggestions">
            {suggestions.map((p) => (
              <button
                key={p.id}
                type="button"
                className="suggestion-item"
                onClick={() => addProduct(p)}
              >
                <strong>{p.name}</strong>
                <span>
                  Cód. {p.sku || p.id}
                  {p.barcode ? ` | Barras: ${p.barcode}` : ''}
                  {p.category ? ` | ${p.category}` : ''}
                  {p.unit ? ` | ${p.unit}` : ''} | {formatBRL(p.price_cents)} | Estoque {p.stock_qty}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th>Código</th>
                <th>Qtd</th>
                <th>Valor unit.</th>
                <th>Subtotal</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {cart.map((line) => (
                <tr key={line.key}>
                  <td>{line.name}</td>
                  <td>{lineCode(line)}</td>
                  <td>
                    {locked ? (
                      line.quantity
                    ) : (
                      <input
                        className="field-input"
                        style={{ width: 72 }}
                        type="number"
                        min={1}
                        step={1}
                        value={line.quantity}
                        onChange={(e) => {
                          const q = Math.max(1, Number(e.target.value) || 1);
                          setCart((prev) =>
                            prev.map((l) => (l.key === line.key ? { ...l, quantity: q } : l))
                          );
                        }}
                      />
                    )}
                  </td>
                  <td>{formatBRL(line.unitPriceCents)}</td>
                  <td>{formatBRL(lineTotal(line))}</td>
                  <td>
                    {!locked && (
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => setCart((prev) => prev.filter((l) => l.key !== line.key))}
                      >
                        Remover
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {cart.length === 0 && (
                <tr>
                  <td colSpan={6}>Nenhum item. Busque produtos ou leia o código de barras.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="summary-block">
          <div className="summary-row">
            <span>Subtotal</span>
            <span>{formatBRL(subtotal)}</span>
          </div>
          <div className="summary-row">
            <span>Desconto</span>
            <span>{formatBRL(discountCents)}</span>
          </div>
          <div className="summary-row big">
            <span>Total</span>
            <span>{formatBRL(totalCents)}</span>
          </div>
        </div>

        <div className="modal-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          {!locked && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void saveQuote()}>
              Salvar orçamento
            </button>
          )}
          {editingId && (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => void viewPdf()}>
                Gerar / Visualizar PDF
              </button>
              <button type="button" className="btn btn-accent" onClick={() => void savePdfDisk()}>
                Salvar PDF no computador
              </button>
              <button type="button" className="btn btn-ghost" onClick={printQuote}>
                Imprimir
              </button>
              <button type="button" className="btn btn-accent" onClick={() => void sendWhatsApp()}>
                Enviar PDF no WhatsApp
              </button>
              {!locked && (
                <button type="button" className="btn btn-primary" onClick={() => void convertToSale()}>
                  Converter em venda
                </button>
              )}
              {!locked && (
                <button type="button" className="btn btn-danger" onClick={() => void doCancel()}>
                  Cancelar orçamento
                </button>
              )}
            </>
          )}
        </div>
        {pdfMeta && (
          <p className="muted-line">
            Último PDF: <code>{pdfMeta.filename}</code>
          </p>
        )}
      </div>

      {showMisc && (
        <MiscItemModal
          onCancel={() => setShowMisc(false)}
          onConfirm={(name, unitPriceCents, quantity) => {
            setCart((prev) => [...prev, miscLine(name, unitPriceCents, quantity)]);
            setShowMisc(false);
          }}
        />
      )}
    </section>
  );
}
