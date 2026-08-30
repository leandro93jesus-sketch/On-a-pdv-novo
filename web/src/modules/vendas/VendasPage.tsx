import { useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelSale as cancelCompletedSale,
  createDeliveryOrderApi,
  createSale,
  createStockMovement,
  fetchOpenCash,
  fetchProducts,
  fetchSale,
  formatBRL,
  markQuoteConvertedApi,
  type CashSession,
  type Customer,
  type Product,
  type Sale,
} from '../../api/client';
import DeliveryAddressForm, {
  emptyDeliveryAddress,
  type DeliveryAddressFormValue,
} from '../entregas/DeliveryAddressForm';
import { isDeliveryAddressComplete } from '../entregas/deliveryAddress';
import CancelSaleConfirmModal from './CancelSaleConfirmModal';
import CustomerPicker from './CustomerPicker';
import MiscItemModal from './MiscItemModal';
import MixedPaymentModal, { type MixedAmounts } from './MixedPaymentModal';
import CardPaymentModal, { type CardType } from './CardPaymentModal';
import QuickProductModal from './QuickProductModal';
import ReceiptModal from './ReceiptModal';
import SaleRecoveryModal from './SaleRecoveryModal';
import SalesHistoryModal from './SalesHistoryModal';
import AdminAuthModal, { CANCEL_REASON_OPTIONS } from './AdminAuthModal';
import {
  clearDraft,
  getMemoryDraft,
  hasOpenSaleContent,
  loadPersistedDraft,
  saveDraft,
  type SaleDraft,
  type SaleMode,
} from './saleDraftStore';
import {
  lineCode,
  lineTotal,
  miscLine,
  productToLine,
  type CartLine,
  type PaymentMethod,
} from './types';
import { QUOTE_TO_SALE_KEY } from '../orcamentos/quoteConversion';

const PAYMENTS_ROW1: { id: PaymentMethod; label: string }[] = [
  { id: 'dinheiro', label: 'Dinheiro' },
  { id: 'pix', label: 'Pix' },
  { id: 'cartao', label: 'Cartão' },
];
const PAYMENTS_ROW2: { id: PaymentMethod; label: string }[] = [
  { id: 'crediario', label: 'Crediário' },
  { id: 'misto', label: 'Misto' },
];

const SUGGESTION_LIMIT = 12;

function parseDiscountInput(value: string): { ok: true; cents: number } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, cents: 0 };
  if (trimmed.includes('-')) {
    return { ok: false, error: 'Desconto não pode ser negativo.' };
  }
  const normalized = trimmed.replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, error: 'Desconto inválido.' };
  }
  return { ok: true, cents: Math.round(n * 100) };
}

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultCreditFirstDue(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

export default function VendasPage() {
  const [saleMode, setSaleMode] = useState<SaleMode>('normal');
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [payment, setPayment] = useState<PaymentMethod>('dinheiro');
  const [cardType, setCardType] = useState<CardType | null>(null);
  const [showCardModal, setShowCardModal] = useState(false);
  const [creditEntryInput, setCreditEntryInput] = useState('0,00');
  const [creditInstallments, setCreditInstallments] = useState(1);
  const [creditFirstDue, setCreditFirstDue] = useState(defaultCreditFirstDue);
  const [cashReceivedInput, setCashReceivedInput] = useState('');
  const [discountInput, setDiscountInput] = useState('0,00');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showMisc, setShowMisc] = useState(false);
  const [showMixed, setShowMixed] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [mixedDraft, setMixedDraft] = useState<MixedAmounts | null>(null);
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [cash, setCash] = useState<CashSession | null>(null);
  const [customerOpenReq, setCustomerOpenReq] = useState(0);
  const [receiptFromHistory, setReceiptFromHistory] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [deliveryAddr, setDeliveryAddr] = useState<DeliveryAddressFormValue>(emptyDeliveryAddress);
  const [draftReady, setDraftReady] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [pendingRecovery, setPendingRecovery] = useState<SaleDraft | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [quickBarcode, setQuickBarcode] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const cashReceivedRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<number | null>(null);
  const submittingRef = useRef(false);
  const requestIdRef = useRef<string | null>(null);
  const scanLockRef = useRef(false);
  const [stockWarn, setStockWarn] = useState<{
    product: Product;
    available: number;
    requested: number;
  } | null>(null);
  const [scanToast, setScanToast] = useState<{ name: string; qty: number } | null>(null);
  const [quickStockQty, setQuickStockQty] = useState('');
  const [quickStockBusy, setQuickStockBusy] = useState(false);
  const scanToastTimer = useRef<number | null>(null);
  const [receiptCancelSale, setReceiptCancelSale] = useState<Sale | null>(null);
  const isDeliveryMode = saleMode === 'entrega';

  function looksLikeBarcode(term: string): boolean {
    return /^[0-9]{8,18}$/.test(term.trim());
  }

  function applyDraft(draft: SaleDraft) {
    setSaleMode(draft.saleMode || 'normal');
    setCart(Array.isArray(draft.cart) ? draft.cart : []);
    setCustomer(draft.customer ?? null);
    setDiscountInput(draft.discountInput || '0,00');
    setPayment(draft.payment || 'dinheiro');
    setCardType(draft.cardType ?? null);
    setCashReceivedInput(draft.cashReceivedInput || '');
    setCreditEntryInput(draft.creditEntryInput || '0,00');
    setCreditInstallments(draft.creditInstallments || 1);
    setCreditFirstDue(draft.creditFirstDue || defaultCreditFirstDue());
    setMixedDraft(draft.mixedDraft ?? null);
    setDeliveryAddr(draft.deliveryAddr || emptyDeliveryAddress());
    setQtyDrafts({});
  }

  function fillDeliveryFromCustomer(c: Customer | null) {
    if (!c) return;
    setDeliveryAddr({
      phone: c.phone || c.whatsapp || '',
      zip_code: c.zip_code || '',
      address: c.address || '',
      address_number: c.address_number || '',
      complement: '',
      neighborhood: c.neighborhood || '',
      city: c.city || '',
      state: c.state || '',
      reference_note: '',
      notes: '',
    });
  }

  function clearDeliveryFields() {
    setDeliveryAddr(emptyDeliveryAddress());
  }

  function resetOpenSaleFields() {
    setCart([]);
    setDiscountInput('0,00');
    setPayment('dinheiro');
    setCardType(null);
    setCreditEntryInput('0,00');
    setCreditInstallments(1);
    setCreditFirstDue(defaultCreditFirstDue());
    setCashReceivedInput('');
    setMixedDraft(null);
    setShowMixed(false);
    setQtyDrafts({});
    setCustomer(null);
    clearDeliveryFields();
    requestIdRef.current = null;
    clearDraft();
  }

  function buildCurrentDraft(): SaleDraft {
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      saleMode,
      cart,
      customer,
      discountInput,
      payment,
      cardType,
      cashReceivedInput,
      creditEntryInput,
      creditInstallments,
      creditFirstDue,
      mixedDraft,
      deliveryAddr,
    };
  }

  function focusSearch() {
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }

  const anyModalOpen =
    showMisc ||
    showMixed ||
    showHistory ||
    showCardModal ||
    showRecovery ||
    showCancelConfirm ||
    Boolean(quickBarcode) ||
    Boolean(receipt);
  const showSuggestions = query.trim().length > 0;

  async function searchProducts(q?: string, barcode?: string) {
    const list = await fetchProducts({ q, barcode });
    setSuggestions(list.slice(0, SUGGESTION_LIMIT));
    setHighlightIdx(0);
    return list;
  }

  async function loadCash() {
    setCash(await fetchOpenCash());
  }

  useEffect(() => {
    (async () => {
      try {
        await loadCash();
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao carregar dados');
      } finally {
        searchRef.current?.focus();
      }
    })();
  }, []);

  useEffect(() => {
    return () => {
      if (scanToastTimer.current) window.clearTimeout(scanToastTimer.current);
    };
  }, []);

  // Carrinho persistente: memória (troca de menu) + localStorage (fechamento inesperado).
  useEffect(() => {
    const mem = getMemoryDraft();
    if (hasOpenSaleContent(mem)) {
      applyDraft(mem!);
      setDraftReady(true);
      return;
    }
    const persisted = loadPersistedDraft();
    if (hasOpenSaleContent(persisted)) {
      // Conversão de orçamento: aplica direto sem modal de recuperação.
      let fromQuote = false;
      try {
        fromQuote = Boolean(sessionStorage.getItem(QUOTE_TO_SALE_KEY));
      } catch {
        fromQuote = false;
      }
      if (fromQuote) {
        applyDraft(persisted!);
        setNotice('Itens do orçamento carregados. Finalize a venda para baixar estoque/caixa.');
        setDraftReady(true);
        return;
      }
      setPendingRecovery(persisted);
      setShowRecovery(true);
      setDraftReady(true);
      return;
    }
    setDraftReady(true);
  }, []);

  useEffect(() => {
    if (!draftReady || showRecovery) return;
    const draft = buildCurrentDraft();
    if (hasOpenSaleContent(draft)) {
      saveDraft(draft);
    } else {
      clearDraft();
    }
    // buildCurrentDraft lê estado atual; deps listam todos os campos persistidos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    draftReady,
    showRecovery,
    saleMode,
    cart,
    customer,
    discountInput,
    payment,
    cardType,
    cashReceivedInput,
    creditEntryInput,
    creditInstallments,
    creditFirstDue,
    mixedDraft,
    deliveryAddr,
  ]);

  useEffect(() => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    const term = query.trim();
    if (!term) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    // Durante leitura de código de barras NÃO popular sugestões por LIKE (evita produto errado).
    if (looksLikeBarcode(term)) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = window.setTimeout(async () => {
      try {
        await searchProducts(term);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro na busca');
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    };
  }, [query]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inEditable =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        (e.target as HTMLElement)?.isContentEditable;

      if (e.key === 'Escape') {
        if (showMisc) {
          setShowMisc(false);
          focusSearch();
          return;
        }
        if (showCardModal) {
          setShowCardModal(false);
          focusSearch();
          return;
        }
        if (quickBarcode) {
          setQuickBarcode(null);
          focusSearch();
          return;
        }
        if (showCancelConfirm) {
          setShowCancelConfirm(false);
          return;
        }
        if (showMixed) {
          setShowMixed(false);
          if (!mixedDraft) setPayment('dinheiro');
          focusSearch();
          return;
        }
        if (showHistory) {
          setShowHistory(false);
          focusSearch();
          return;
        }
        if (receipt) {
          setReceipt(null);
          focusSearch();
          return;
        }
        if (query) {
          setQuery('');
          setSuggestions([]);
          return;
        }
        return;
      }

      if (anyModalOpen) return;
      if (e.key === 'F2') {
        e.preventDefault();
        focusSearch();
        return;
      }
      if (e.key === 'F4') {
        e.preventDefault();
        setCustomerOpenReq((n) => n + 1);
        return;
      }
      if (e.key === 'F8') {
        e.preventDefault();
        setShowHistory(true);
        return;
      }
      if (e.key === 'F9') {
        e.preventDefault();
        setShowMisc(true);
        return;
      }
      if (e.key === 'F10') {
        e.preventDefault();
        if (!inEditable || tag === 'INPUT') {
          if (saleMode === 'entrega') void createDeliveryOrderFromCart();
          else void finalizeSale();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    anyModalOpen,
    showMisc,
    showMixed,
    showCardModal,
    showHistory,
    showCancelConfirm,
    quickBarcode,
    receipt,
    mixedDraft,
    cart,
    payment,
    cardType,
    discountInput,
    customer,
    query,
    saleMode,
    deliveryAddr,
  ]);

  const subtotal = useMemo(() => cart.reduce((sum, line) => sum + lineTotal(line), 0), [cart]);
  const parsedDiscount = parseDiscountInput(discountInput);
  const discountCents = parsedDiscount.ok ? Math.min(parsedDiscount.cents, subtotal) : 0;
  const total = Math.max(subtotal - discountCents, 0);
  // Troco em dinheiro: calculado a cada digitação, sem depender de botão.
  const cashReceivedCents = useMemo(() => {
    const raw = cashReceivedInput.trim();
    if (!raw) return null;
    const n = Number(raw.replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
  }, [cashReceivedInput]);
  const cashShortfall = cashReceivedCents == null ? 0 : Math.max(total - cashReceivedCents, 0);
  const itemCount = cart.length;
  const unitCount = useMemo(() => cart.reduce((sum, line) => sum + line.quantity, 0), [cart]);

  function clearSearch() {
    setQuery('');
    setSuggestions([]);
    focusSearch();
  }

  function showScanToast(name: string, qty: number) {
    setScanToast({ name, qty });
    if (scanToastTimer.current) window.clearTimeout(scanToastTimer.current);
    scanToastTimer.current = window.setTimeout(() => setScanToast(null), 2500);
  }

  function addProduct(product: Product, opts?: { force?: boolean; qty?: number }) {
    setError(null);
    setNotice(null);
    setReceipt(null);
    const addQty = Math.max(1, Math.floor(Number(opts?.qty) || 1));

    setCart((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      const nextQty = (existing?.quantity || 0) + addQty;
      const available = existing?.stockQty ?? product.stock_qty;
      const allowNeg =
        Boolean(existing?.allowNegative) || Boolean(product.allow_negative_stock) || true;

      if (!opts?.force && available != null && nextQty > available) {
        setStockWarn({
          product,
          available: Number(available),
          requested: nextQty,
        });
        setQuickStockQty(String(Math.max(nextQty - Number(available), 1)));
        return prev;
      }

      if (existing) {
        showScanToast(product.name, nextQty);
        return prev.map((l) =>
          l.productId === product.id ? { ...l, quantity: nextQty, allowNegative: allowNeg } : l
        );
      }
      showScanToast(product.name, addQty);
      const line = productToLine(product, addQty);
      return [...prev, { ...line, allowNegative: allowNeg }];
    });
    clearSearch();
  }

  function confirmStockWarnContinue() {
    if (!stockWarn) return;
    const { product, requested } = stockWarn;
    setStockWarn(null);
    setQuickStockQty('');
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      if (existing) {
        showScanToast(product.name, requested);
        return prev.map((l) =>
          l.productId === product.id
            ? { ...l, quantity: requested, allowNegative: true }
            : l
        );
      }
      showScanToast(product.name, requested);
      const line = productToLine(product, requested);
      return [...prev, { ...line, allowNegative: true }];
    });
    clearSearch();
  }

  async function quickAdjustStockFromWarn() {
    if (!stockWarn) return;
    const qty = Number(String(quickStockQty).replace(',', '.'));
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty)) {
      setError('Informe a quantidade recebida (número inteiro).');
      return;
    }
    setQuickStockBusy(true);
    try {
      const { product, requested } = stockWarn;
      const result = await createStockMovement({
        product_id: product.id,
        movement_type: 'entry',
        quantity: qty,
        reason: 'Entrada manual',
      });
      const newStock = Number(result.stock_after);
      setStockWarn(null);
      setQuickStockQty('');
      setCart((prev) => {
        const existing = prev.find((l) => l.productId === product.id);
        const allowNeg = true;
        if (existing) {
          showScanToast(product.name, requested);
          return prev.map((l) =>
            l.productId === product.id
              ? { ...l, quantity: requested, stockQty: newStock, allowNegative: allowNeg }
              : l
          );
        }
        showScanToast(product.name, requested);
        const line = productToLine({ ...product, stock_qty: newStock }, requested);
        return [...prev, { ...line, allowNegative: allowNeg }];
      });
      clearSearch();
      setNotice(`Estoque de "${product.name}" atualizado para ${newStock}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao ajustar estoque');
    } finally {
      setQuickStockBusy(false);
    }
  }

  function changeQty(key: string, delta: number) {
    setError(null);
    setCart((prev) =>
      prev
        .map((line) => {
          if (line.key !== key) return line;
          const nextQty = line.quantity + delta;
          if (nextQty <= 0) return { ...line, quantity: 0 };
          // Permite ultrapassar estoque (aviso não bloqueante só no scan)
          setQtyDrafts((d) => {
            const next = { ...d };
            delete next[key];
            return next;
          });
          return { ...line, quantity: nextQty, allowNegative: true };
        })
        .filter((l) => l.quantity > 0)
    );
  }

  function applyQtyInput(key: string) {
    const raw = qtyDrafts[key];
    if (raw == null) return;
    const n = Number(String(raw).replace(',', '.'));
    setError(null);
    if (!Number.isInteger(n) || n <= 0) {
      setError('Quantidade inválida. Use um número inteiro maior que zero.');
      setQtyDrafts((d) => {
        const next = { ...d };
        delete next[key];
        return next;
      });
      return;
    }
    setCart((prev) =>
      prev.map((line) => {
        if (line.key !== key) return line;
        return { ...line, quantity: n, allowNegative: true };
      })
    );
    setQtyDrafts((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });
  }

  function removeLine(key: string) {
    setCart((prev) => prev.filter((l) => l.key !== key));
  }

  function requestCancelSale() {
    if (cart.length === 0) return;
    setShowCancelConfirm(true);
  }

  function confirmCancelSale() {
    setShowCancelConfirm(false);
    resetOpenSaleFields();
    setError(null);
    setNotice(
      isDeliveryMode
        ? 'Pedido limpo. Nada foi registrado.'
        : 'Venda cancelada antes da conclusão. Nada foi registrado.'
    );
    setReceipt(null);
    clearSearch();
  }

  async function handleBarcodeOrSearch() {
    const term = query.trim();
    if (!term) return;
    if (scanLockRef.current) return;

    if (looksLikeBarcode(term)) {
      scanLockRef.current = true;
      setSuggestions([]);
      try {
        const found = await fetchProducts({ barcode: term });
        const active = found.filter((p) => p.active !== 0);
        // Correspondência EXATA apenas — nunca cair em outro produto por proximidade.
        const exact = active.find((p) => String(p.barcode || '').trim() === term);
        if (exact) {
          addProduct(exact);
          return;
        }
        setError(null);
        setQuickBarcode(term);
        setQuery('');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro na busca');
      } finally {
        // Liberar imediatamente: leituras legítimas em sequência (1→2→3…) devem passar.
        // O lock só evita Enter+submit/handlers duplicados no mesmo ciclo async.
        scanLockRef.current = false;
      }
      return;
    }

    try {
      const found = await searchProducts(term);
      if (found.length === 1) {
        addProduct(found[0]);
      } else if (found.length === 0) {
        setError('Nenhum produto encontrado.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro na busca');
    }
  }

  async function createDeliveryOrderFromCart() {
    if (cart.length === 0 || submittingRef.current) return;

    const discountParse = parseDiscountInput(discountInput);
    if (!discountParse.ok) {
      setError(discountParse.error);
      return;
    }
    if (discountParse.cents > subtotal) {
      setError('Desconto não pode ser maior que o subtotal.');
      return;
    }
    if (!isDeliveryAddressComplete(deliveryAddr)) {
      setError('ENDEREÇO INCOMPLETO PARA GERAR ROTA. Informe rua, número e cidade.');
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    setNotice(null);

    if (!requestIdRef.current) {
      requestIdRef.current = newRequestId();
    }

    try {
      const order = await createDeliveryOrderApi({
        client_request_id: requestIdRef.current,
        customer_id: customer?.id ?? null,
        customer_name: customer?.name || null,
        phone: deliveryAddr.phone.trim() || customer?.phone || null,
        address: deliveryAddr.address.trim(),
        address_number: deliveryAddr.address_number.trim(),
        complement: deliveryAddr.complement.trim() || null,
        neighborhood: deliveryAddr.neighborhood.trim() || null,
        city: deliveryAddr.city.trim(),
        state: deliveryAddr.state.trim() || null,
        zip_code: deliveryAddr.zip_code.trim() || null,
        reference_note: deliveryAddr.reference_note.trim() || null,
        notes: deliveryAddr.notes.trim() || null,
        discount_cents: discountParse.cents,
        items: cart.map((line) => ({
          product_id: line.productId,
          name: line.name,
          quantity: line.quantity,
          unit_price_cents: line.unitPriceCents,
          is_misc: line.isMisc,
        })),
      });

      resetOpenSaleFields();
      setSaleMode('entrega');
      setNotice(
        `Pedido ${order.order_number} criado — AGUARDANDO PAGAMENTO. Estoque reservado. Não entrou no caixa.`
      );
      clearSearch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao criar pedido de entrega');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function finalizeSale(mixedOverride?: MixedAmounts, cardTypeOverride?: CardType | null) {
    if (isDeliveryMode) {
      await createDeliveryOrderFromCart();
      return;
    }
    if (cart.length === 0 || submittingRef.current) return;

    const discountParse = parseDiscountInput(discountInput);
    if (!discountParse.ok) {
      setError(discountParse.error);
      return;
    }
    if (discountParse.cents > subtotal) {
      setError('Desconto não pode ser maior que o subtotal.');
      return;
    }

    const effectiveCardType = cardTypeOverride ?? cardType;
    const mode = mixedOverride ? 'misto' : payment === 'cartao' || cardTypeOverride ? 'cartao' : payment;
    if (mode === 'misto' && !mixedOverride && !mixedDraft) {
      setShowMixed(true);
      return;
    }
    const mixed = mixedOverride || mixedDraft;

    if (mode === 'cartao' && !effectiveCardType) {
      setShowCardModal(true);
      return;
    }
    if (
      mode === 'misto' &&
      mixed &&
      (mixed.cartao_credito ?? 0) + (mixed.cartao_debito ?? 0) + (mixed.cartao ?? 0) > 0
    ) {
      const hasSplit =
        (mixed.cartao_credito ?? 0) > 0 || (mixed.cartao_debito ?? 0) > 0;
      if (!hasSplit && !mixed.card_type) {
        setError('Informe se o cartão (no misto) é Crédito ou Débito.');
        return;
      }
    }

    if ((mode === 'crediario' || (mixed && mixed.crediario > 0)) && !customer) {
      setError('Venda no crediário exige cliente selecionado.');
      return;
    }
    if (mode === 'crediario') {
      const entryNorm = creditEntryInput.trim().replace(/\./g, '').replace(',', '.');
      const entryN = Number(entryNorm || '0');
      if (!Number.isFinite(entryN) || entryN < 0) {
        setError('Entrada do crediário inválida.');
        return;
      }
      if (!Number.isInteger(creditInstallments) || creditInstallments < 1) {
        setError('Número de parcelas inválido.');
        return;
      }
    }

    let amountReceivedCents: number | undefined;
    if (mode === 'dinheiro') {
      const raw = cashReceivedInput.trim();
      if (!raw) {
        setError('Informe o valor recebido em dinheiro para calcular o troco.');
        return;
      }
      const n = Number(raw.replace(/\./g, '').replace(',', '.'));
      if (!Number.isFinite(n) || n < 0) {
        setError('Valor recebido inválido.');
        return;
      }
      amountReceivedCents = Math.round(n * 100);
      if (amountReceivedCents < total) {
        setError(
          `FALTAM ${formatBRL(total - amountReceivedCents)}. Informe o valor correto ou use pagamento misto.`
        );
        cashReceivedRef.current?.focus();
        return;
      }
    }

    await loadCash();
    const openCashNow = await fetchOpenCash();
    setCash(openCashNow);
    if (!openCashNow) {
      setError('Não há caixa aberto. Abra o caixa em Caixa antes de concluir a venda.');
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    setNotice(null);

    if (!requestIdRef.current) {
      requestIdRef.current = newRequestId();
    }

    try {
      const entryCents =
        mode === 'crediario'
          ? Math.round(
              Number(creditEntryInput.trim().replace(/\./g, '').replace(',', '.') || '0') * 100
            )
          : 0;

      const payments =
        mode === 'misto' && mixed
          ? (
              [
                { method: 'dinheiro', amount_cents: mixed.dinheiro },
                { method: 'pix', amount_cents: mixed.pix },
                {
                  method: 'cartao',
                  amount_cents: mixed.cartao_credito ?? 0,
                  card_type: 'CREDIT' as const,
                },
                {
                  method: 'cartao',
                  amount_cents: mixed.cartao_debito ?? 0,
                  card_type: 'DEBIT' as const,
                },
                ...(mixed.cartao && mixed.card_type
                  ? [
                      {
                        method: 'cartao',
                        amount_cents: mixed.cartao,
                        card_type: mixed.card_type,
                      },
                    ]
                  : []),
                { method: 'crediario', amount_cents: mixed.crediario },
              ] as Array<{
                method: string;
                amount_cents: number;
                card_type?: 'CREDIT' | 'DEBIT';
              }>
            ).filter((p) => p.amount_cents > 0)
          : undefined;

      const sale = await createSale({
        payment_method: mode === 'misto' ? undefined : mode,
        payments,
        card_type: mode === 'cartao' ? effectiveCardType : undefined,
        amount_received_cents:
          mode === 'misto' && mixed ? mixed.amount_received_cents : amountReceivedCents,
        discount_cents: discountParse.cents,
        client_request_id: requestIdRef.current,
        customer_id: customer?.id ?? null,
        items: cart.map((line) => ({
          product_id: line.productId,
          name: line.name,
          quantity: line.quantity,
          unit_price_cents: line.unitPriceCents,
          discount_cents: line.discountCents,
          is_misc: line.isMisc,
        })),
        credit:
          mode === 'crediario' || (mixed && mixed.crediario > 0)
            ? {
                entry_cents: mode === 'crediario' ? entryCents : 0,
                installment_count: mode === 'crediario' ? creditInstallments : 1,
                first_due_date: mode === 'crediario' ? creditFirstDue : undefined,
              }
            : undefined,
      });
      const full = await fetchSale(sale.id);
      setReceiptFromHistory(false);
      setReceipt(full);
      resetOpenSaleFields();
      setNotice(`Venda ${full.sale_number} concluída com sucesso.`);
      try {
        const raw = sessionStorage.getItem(QUOTE_TO_SALE_KEY);
        if (raw) {
          const meta = JSON.parse(raw) as { quote_id?: number; quote_number?: string };
          if (meta.quote_id) {
            await markQuoteConvertedApi(meta.quote_id, full.id);
            setNotice(
              `Venda ${full.sale_number} concluída. Orçamento ${meta.quote_number || meta.quote_id} marcado como convertido.`
            );
          }
          sessionStorage.removeItem(QUOTE_TO_SALE_KEY);
        }
      } catch {
        /* vínculo do orçamento é best-effort; venda já está salva */
      }
      await loadCash();
      clearSearch();
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === 'CASH_SESSION_REQUIRED') {
        setError('Não há caixa aberto. Abra o caixa antes de concluir a venda.');
      } else if (err.code === 'CUSTOMER_REQUIRED_FOR_CREDIT') {
        setError('Venda no crediário exige cliente selecionado.');
      } else {
        setError(err.message || 'Erro ao finalizar a venda');
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function handleCancelSale(sale: Sale) {
    setReceipt(null);
    setReceiptCancelSale(sale);
  }

  return (
    <div
      className={
        isDeliveryMode
          ? 'sales-layout sales-layout-stack sales-mode-delivery'
          : 'sales-layout sales-layout-stack'
      }
    >
      <section className="sales-top">
        <div className="sales-status-row">
          <span className={cash ? 'status-pill status-ok' : 'status-pill status-warn'}>
            {cash
              ? `Caixa aberto · ${cash.operator_name}`
              : 'Caixa fechado — abra o caixa para vender'}
          </span>
          <div className="sale-mode-toggle" role="group" aria-label="Modo de venda">
            <button
              type="button"
              className={saleMode === 'normal' ? 'btn btn-primary' : 'btn btn-ghost'}
              onClick={() => {
                setSaleMode('normal');
                setError(null);
                setNotice(null);
              }}
            >
              VENDA NORMAL
            </button>
            <button
              type="button"
              className={saleMode === 'entrega' ? 'btn btn-accent' : 'btn btn-ghost'}
              onClick={() => {
                setSaleMode('entrega');
                setError(null);
                setNotice(null);
                if (customer) fillDeliveryFromCustomer(customer);
                focusSearch();
              }}
            >
              ENTREGA
            </button>
          </div>
        </div>

        {isDeliveryMode && (
          <div className="delivery-mode-banner" role="status">
            <strong>MODO ENTREGA</strong>
            <span>PEDIDO AINDA NÃO RECEBIDO — não entra no caixa ao criar</span>
          </div>
        )}

        <CustomerPicker
          selected={customer}
          onSelect={(c) => {
            setCustomer(c);
            if (isDeliveryMode) fillDeliveryFromCustomer(c);
          }}
          openRequest={customerOpenReq}
          onClosed={focusSearch}
        />

        {isDeliveryMode && (
          <DeliveryAddressForm
            value={deliveryAddr}
            onChange={setDeliveryAddr}
            showCustomerHint
          />
        )}

        <div className="search-block">
          <div className="search-row">
            <input
              ref={searchRef}
              className="search-input"
              placeholder="Buscar produto ou ler código de barras…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' && suggestions.length > 0) {
                  e.preventDefault();
                  setHighlightIdx((i) => Math.min(i + 1, suggestions.length - 1));
                  return;
                }
                if (e.key === 'ArrowUp' && suggestions.length > 0) {
                  e.preventDefault();
                  setHighlightIdx((i) => Math.max(i - 1, 0));
                  return;
                }
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  // Código de barras: NUNCA usar sugestão parcial — só path exato.
                  if (looksLikeBarcode(query)) {
                    void handleBarcodeOrSearch();
                    return;
                  }
                  if (suggestions.length === 1) {
                    addProduct(suggestions[0]);
                    return;
                  }
                  if (suggestions.length > 1 && suggestions[highlightIdx]) {
                    addProduct(suggestions[highlightIdx]);
                    return;
                  }
                  void handleBarcodeOrSearch();
                }
              }}
              aria-label="Busca de produtos"
              aria-autocomplete="list"
              aria-expanded={showSuggestions}
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleBarcodeOrSearch()}
            >
              Buscar
            </button>
            <button type="button" className="btn btn-accent" onClick={() => setShowMisc(true)}>
              Item Diversos
            </button>
          </div>

          {showSuggestions && (
            <div className="search-suggestions" role="listbox" aria-label="Sugestões de produtos">
              {searching && <div className="suggestion-empty">Buscando…</div>}
              {!searching && suggestions.length === 0 && (
                <div className="suggestion-empty">Nenhum produto encontrado.</div>
              )}
              {!searching &&
                suggestions.map((product, idx) => {
                  const min = product.min_stock_qty ?? 0;
                  const noStock = product.stock_qty <= 0;
                  const lowStock = !noStock && product.stock_qty <= min;
                  return (
                    <button
                      key={product.id}
                      type="button"
                      role="option"
                      aria-selected={idx === highlightIdx}
                      className={
                        idx === highlightIdx ? 'suggestion-item active' : 'suggestion-item'
                      }
                      onMouseEnter={() => setHighlightIdx(idx)}
                      onClick={() => addProduct(product)}
                    >
                      <span className="suggestion-name">
                        {product.name}
                        {noStock && <span className="stock-flag stock-flag-out">Sem estoque</span>}
                        {lowStock && (
                          <span className="stock-flag stock-flag-low">Estoque baixo</span>
                        )}
                      </span>
                      <span className="suggestion-meta">
                        Código: {product.sku || '—'}
                        {product.barcode ? ` | Barras: ${product.barcode}` : ''}
                        {' | '}
                        Estoque: {product.stock_qty}
                        {' | '}
                        {formatBRL(product.price_cents)}
                      </span>
                      <span
                        className={
                          noStock || lowStock
                            ? 'suggestion-stock stock-low'
                            : 'suggestion-stock stock-ok'
                        }
                      >
                        Est. {product.stock_qty}
                      </span>
                      <span className="suggestion-price">{formatBRL(product.price_cents)}</span>
                    </button>
                  );
                })}
            </div>
          )}
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {notice && <div className="alert alert-ok">{notice}</div>}
      </section>

      <section className="cart-panel cart-panel-main">
        <div className="cart-header-row">
          <h3>Carrinho</h3>
          <span className="muted-line">
            {itemCount} item(ns) · {unitCount} unidade(s)
          </span>
        </div>

        {cart.length === 0 ? (
          <p className="cart-empty">
            Carrinho vazio.
            <br />
            Digite na busca, leia o código de barras ou use Item Diversos.
          </p>
        ) : (
          <div className="cart-table-wrap">
            <table className="cart-table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Código</th>
                  <th>Unitário</th>
                  <th>Qtd</th>
                  <th>Subtotal</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {cart.map((line) => (
                  <tr key={line.key}>
                    <td>
                      <div className="cart-line-name">
                        {line.name}
                        {line.isMisc && <span className="misc-tag">Diversos</span>}
                      </div>
                      {line.stockQty != null && (
                        <div className="cart-line-meta">Estoque: {line.stockQty}</div>
                      )}
                    </td>
                    <td>{lineCode(line)}</td>
                    <td>{formatBRL(line.unitPriceCents)}</td>
                    <td>
                      <div className="qty-control">
                        <button
                          type="button"
                          aria-label="Diminuir"
                          onClick={() => changeQty(line.key, -1)}
                        >
                          −
                        </button>
                        <input
                          className="qty-input"
                          aria-label="Quantidade"
                          value={qtyDrafts[line.key] ?? String(line.quantity)}
                          onFocus={(e) => e.currentTarget.select()}
                          onChange={(e) =>
                            setQtyDrafts((d) => ({ ...d, [line.key]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              applyQtyInput(line.key);
                            }
                          }}
                          onBlur={() => applyQtyInput(line.key)}
                          inputMode="numeric"
                        />
                        <button
                          type="button"
                          aria-label="Aumentar"
                          onClick={() => changeQty(line.key, 1)}
                        >
                          +
                        </button>
                      </div>
                    </td>
                    <td className="cart-line-total">{formatBRL(lineTotal(line))}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: '6px 10px' }}
                        onClick={() => removeLine(line.key)}
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="cart-summary cart-summary-wide">
          <div className="sale-summary-grid">
            <div className="summary-chip">
              <span>Itens</span>
              <strong>{itemCount}</strong>
            </div>
            <div className="summary-chip">
              <span>Unidades</span>
              <strong>{unitCount}</strong>
            </div>
            <div className="summary-chip">
              <span>Subtotal</span>
              <strong>{formatBRL(subtotal)}</strong>
            </div>
            <div className="summary-chip summary-chip-discount">
              <span>Desconto (R$)</span>
              <input
                value={discountInput}
                onChange={(e) => setDiscountInput(e.target.value)}
                inputMode="decimal"
                aria-label="Desconto da venda"
              />
            </div>
          </div>

          <div className="total-block" data-testid="cart-total">
            <span>Total</span>
            <strong>{formatBRL(total)}</strong>
          </div>

          {!isDeliveryMode ? (
            <div>
              <div className="summary-row" style={{ marginBottom: 8 }}>
                <span>Forma de pagamento</span>
              </div>
              <div className="payment-options">
                {PAYMENTS_ROW1.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={m.id === payment ? 'pay-btn active' : 'pay-btn'}
                    onClick={() => {
                      if (m.id === 'cartao') {
                        setMixedDraft(null);
                        setShowCardModal(true);
                        return;
                      }
                      setPayment(m.id);
                      setMixedDraft(null);
                      setCardType(null);
                      if (m.id === 'dinheiro') {
                        // Foco direto no valor recebido para o caixa só digitar.
                        window.setTimeout(() => cashReceivedRef.current?.focus(), 0);
                      }
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {payment === 'cartao' && cardType ? (
                <div className="muted-line" style={{ marginTop: 8 }} data-testid="card-type-selected">
                  Selecionado:{' '}
                  <strong>{cardType === 'CREDIT' ? 'CARTÃO CRÉDITO' : 'CARTÃO DÉBITO'}</strong>
                  <button
                    type="button"
                    className="linkish"
                    style={{ marginLeft: 8 }}
                    onClick={() => setShowCardModal(true)}
                  >
                    Alterar
                  </button>
                </div>
              ) : null}
              <div className="payment-options" style={{ marginTop: 8 }}>
                {PAYMENTS_ROW2.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={m.id === payment ? 'pay-btn active' : 'pay-btn'}
                    onClick={() => {
                      if (m.id === 'misto') {
                        setPayment('misto');
                        setCardType(null);
                        setShowMixed(true);
                        return;
                      }
                      setPayment(m.id);
                      setCardType(null);
                      setMixedDraft(null);
                    }}
                  >
                    {m.label}
                  </button>
                ))}
                <button type="button" className="pay-btn" onClick={() => setShowHistory(true)}>
                  Histórico
                </button>
              </div>

              {payment === 'dinheiro' ? (
                <div className="credit-fields" style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr 1fr',
                      gap: 8,
                      alignItems: 'end',
                    }}
                  >
                    <div>
                      <div className="muted-line">Total da venda</div>
                      <strong style={{ fontSize: '1.15rem' }}>{formatBRL(total)}</strong>
                    </div>
                    <label>
                      Valor recebido (R$)
                      <input
                        ref={cashReceivedRef}
                        value={cashReceivedInput}
                        onChange={(e) => setCashReceivedInput(e.target.value)}
                        inputMode="decimal"
                        placeholder={(total / 100).toFixed(2).replace('.', ',')}
                        autoComplete="off"
                        data-testid="valor-recebido"
                      />
                    </label>
                    <div>
                      <div className="muted-line">{cashShortfall > 0 ? 'Faltam' : 'Troco'}</div>
                      <strong
                        style={{
                          fontSize: '1.25rem',
                          color: cashShortfall > 0 ? '#b42318' : '#0f3d2e',
                        }}
                        data-testid="troco-valor"
                      >
                        {cashReceivedCents == null
                          ? '—'
                          : cashShortfall > 0
                            ? `FALTAM ${formatBRL(cashShortfall)}`
                            : formatBRL(cashReceivedCents - total)}
                      </strong>
                    </div>
                  </div>
                </div>
              ) : null}

              {payment === 'misto' && mixedDraft ? (
                <div className="muted-line" style={{ marginTop: 8 }}>
                  Misto configurado · informado{' '}
                  {formatBRL(
                    mixedDraft.dinheiro +
                      mixedDraft.pix +
                      (mixedDraft.cartao_credito ?? 0) +
                      (mixedDraft.cartao_debito ?? 0) +
                      (mixedDraft.cartao ?? 0) +
                      mixedDraft.crediario
                  )}
                  <button
                    type="button"
                    className="linkish"
                    style={{ marginLeft: 8 }}
                    onClick={() => setShowMixed(true)}
                  >
                    Editar
                  </button>
                </div>
              ) : null}

              {payment === 'crediario' ? (
                <div className="credit-fields" style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                  <label>
                    Entrada (R$)
                    <input
                      value={creditEntryInput}
                      onChange={(e) => setCreditEntryInput(e.target.value)}
                      inputMode="decimal"
                    />
                  </label>
                  <label>
                    Parcelas
                    <input
                      type="number"
                      min={1}
                      value={creditInstallments}
                      onChange={(e) =>
                        setCreditInstallments(Math.max(1, Number(e.target.value) || 1))
                      }
                    />
                  </label>
                  <label>
                    1º vencimento
                    <input
                      type="date"
                      value={creditFirstDue}
                      onChange={(e) => setCreditFirstDue(e.target.value)}
                    />
                  </label>
                  {!customer ? (
                    <span className="alert alert-error" style={{ margin: 0 }}>
                      Selecione um cliente para crediário.
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="delivery-mode-summary">
              <p>
                <strong>Status ao salvar:</strong> AGUARDANDO PAGAMENTO
              </p>
              <p className="muted-line">
                O pagamento (Dinheiro, Pix, Cartão, Crediário ou Misto) é confirmado depois na aba
                Entregas. Aqui só reserva estoque.
              </p>
              <button type="button" className="pay-btn" onClick={() => setShowHistory(true)}>
                Histórico de vendas
              </button>
            </div>
          )}

          <div className="cart-actions">
            <button
              type="button"
              className="btn btn-danger"
              onClick={requestCancelSale}
              disabled={cart.length === 0 || submitting}
            >
              {isDeliveryMode ? 'Limpar pedido' : 'Cancelar venda'}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-finalize"
              onClick={() =>
                void (isDeliveryMode ? createDeliveryOrderFromCart() : finalizeSale())
              }
              disabled={cart.length === 0 || submitting}
            >
              {submitting
                ? isDeliveryMode
                  ? 'Criando pedido…'
                  : 'Finalizando…'
                : isDeliveryMode
                  ? 'CRIAR PEDIDO DE ENTREGA'
                  : 'Finalizar venda'}
            </button>
          </div>
        </div>
      </section>

      {showMisc && (
        <MiscItemModal
          onCancel={() => {
            setShowMisc(false);
            focusSearch();
          }}
          onConfirm={(name, priceCents, quantity) => {
            setCart((prev) => [...prev, miscLine(name, priceCents, quantity)]);
            setShowMisc(false);
            setNotice(null);
            setError(null);
            focusSearch();
          }}
        />
      )}

      {quickBarcode && (
        <QuickProductModal
          barcode={quickBarcode}
          onCancel={() => {
            setQuickBarcode(null);
            clearSearch();
          }}
          onCreated={(product) => {
            setQuickBarcode(null);
            addProduct(product, { force: true });
            setNotice(`Produto "${product.name}" cadastrado e adicionado à venda.`);
            clearSearch();
          }}
          onCreatedOnly={(product) => {
            setQuickBarcode(null);
            setNotice(`Produto "${product.name}" cadastrado. Estoque inicial: ${product.stock_qty}.`);
            clearSearch();
          }}
          onUseExisting={(product) => {
            setQuickBarcode(null);
            addProduct(product);
            setNotice(`Produto existente "${product.name}" adicionado à venda.`);
            clearSearch();
          }}
        />
      )}

      {showRecovery && pendingRecovery && (
        <SaleRecoveryModal
          itemCount={pendingRecovery.cart.length}
          onRecover={() => {
            applyDraft(pendingRecovery);
            saveDraft({ ...pendingRecovery, updatedAt: new Date().toISOString() });
            setPendingRecovery(null);
            setShowRecovery(false);
            setNotice('Venda recuperada. Continue de onde parou.');
            focusSearch();
          }}
          onDiscard={() => {
            clearDraft();
            setPendingRecovery(null);
            setShowRecovery(false);
            setNotice('Rascunho de venda descartado.');
            focusSearch();
          }}
        />
      )}

      {showCancelConfirm && (
        <CancelSaleConfirmModal
          title="EXISTEM ITENS NO CARRINHO"
          confirmLabel={isDeliveryMode ? 'LIMPAR PEDIDO' : 'CANCELAR VENDA'}
          onBack={() => setShowCancelConfirm(false)}
          onConfirm={confirmCancelSale}
        />
      )}

      {showCardModal && (
        <CardPaymentModal
          totalCents={total}
          initialType={cardType}
          onBack={() => {
            setShowCardModal(false);
            focusSearch();
          }}
          onConfirm={(selected) => {
            setCardType(selected);
            setPayment('cartao');
            setMixedDraft(null);
            setShowCardModal(false);
            if (cart.length === 0) {
              setError('Adicione itens ao carrinho antes de confirmar o pagamento.');
              return;
            }
            void finalizeSale(undefined, selected);
          }}
        />
      )}

      {showMixed && (
        <MixedPaymentModal
          totalCents={total}
          hasCustomer={Boolean(customer)}
          onCancel={() => {
            setShowMixed(false);
            if (!mixedDraft) setPayment('dinheiro');
            focusSearch();
          }}
          onConfirm={(payload) => {
            setMixedDraft(payload);
            setPayment('misto');
            setShowMixed(false);
            void finalizeSale(payload);
          }}
        />
      )}

      {showHistory && (
        <SalesHistoryModal
          onClose={() => {
            setShowHistory(false);
            focusSearch();
          }}
        />
      )}

      {scanToast ? (
        <div className="scan-toast" role="status" aria-live="polite">
          <strong>✓ {scanToast.name}</strong>
          <span>Qtd. no carrinho: {scanToast.qty}</span>
        </div>
      ) : null}

      {stockWarn ? (
        <div
          className="compact-alert"
          role="alertdialog"
          aria-labelledby="stock-warn-title"
        >
          <div className="compact-alert-body">
            <strong id="stock-warn-title">
              {stockWarn.available <= 0 ? 'Estoque zerado' : 'Estoque insuficiente'}
            </strong>
            <span>Produto: {stockWarn.product.name}</span>
            <span className="muted-line">
              Atual: {stockWarn.available} · Pedido: {stockWarn.requested}
            </span>
            <label className="compact-alert-qty">
              Quantidade recebida
              <input
                className="field-input"
                type="number"
                min={1}
                step={1}
                value={quickStockQty}
                onChange={(e) => setQuickStockQty(e.target.value)}
                disabled={quickStockBusy}
              />
            </label>
            {Number(String(quickStockQty).replace(',', '.')) > 0 ? (
              <span className="muted-line">
                Novo estoque:{' '}
                {stockWarn.available + Number(String(quickStockQty).replace(',', '.'))}
              </span>
            ) : null}
            <div className="compact-alert-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={quickStockBusy}
                onClick={() => void quickAdjustStockFromWarn()}
              >
                {quickStockBusy ? 'Salvando…' : 'Ajustar estoque'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={quickStockBusy}
                onClick={confirmStockWarnContinue}
              >
                Continuar
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={quickStockBusy}
                onClick={() => {
                  setStockWarn(null);
                  setQuickStockQty('');
                  focusSearch();
                }}
              >
                Agora não
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {receiptCancelSale && (
        <AdminAuthModal
          title={`EXCLUIR / CANCELAR VENDA ${receiptCancelSale.sale_number}`}
          subtitle="A venda será cancelada (estorno) e permanecerá no histórico."
          reasonLabel="MOTIVO DA EXCLUSÃO/CANCELAMENTO"
          reasonOptions={CANCEL_REASON_OPTIONS}
          onCancel={() => setReceiptCancelSale(null)}
          onAuthorized={async ({ password, reason }) => {
            const cancelled = await cancelCompletedSale(receiptCancelSale.id, {
              reason,
              admin_password: password,
              authorized_by: 'Administrador',
            });
            setReceiptCancelSale(null);
            setReceipt(cancelled);
            setNotice(`Venda ${cancelled.sale_number} cancelada. Estoque estornado.`);
            await loadCash();
          }}
        />
      )}

      {receipt && (
        <ReceiptModal
          sale={receipt}
          successBanner={!receiptFromHistory && receipt.status !== 'cancelled'}
          onClose={() => {
            setReceipt(null);
            setReceiptFromHistory(false);
            focusSearch();
          }}
          onCancelSale={
            receiptFromHistory ? undefined : (sale) => void handleCancelSale(sale)
          }
        />
      )}
    </div>
  );
}
