import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * ETAPA 3 — Recuperação de venda após queda (parte do rascunho).
 *
 * Roda o próprio módulo de rascunho sobre um localStorage simulado, cobrindo os
 * testes obrigatórios: rascunho sobrevive ao fechamento, é limpo ao concluir ou
 * cancelar, e um arquivo corrompido não impede o PDV de abrir.
 */

// localStorage simulado: representa o armazenamento que sobrevive ao processo.
class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

globalThis.localStorage = new MemoryStorage();
const avisos = [];
console.warn = (...args) => avisos.push(args.join(' '));

// Executado com: node --experimental-strip-types --test
const {
  clearDraft,
  draftSummary,
  hasOpenSaleContent,
  isValidDraftShape,
  loadPersistedDraft,
  saveDraft,
} = await import('./saleDraftStore.ts');

const CHAVE = 'onca_pdv_open_sale_draft_v1';

function linha(nome, qtd, preco) {
  return {
    key: `p-${nome}`,
    productId: Math.floor(Math.random() * 1000) + 1,
    name: nome,
    sku: null,
    barcode: null,
    unitPriceCents: preco,
    quantity: qtd,
    discountCents: 0,
    isMisc: false,
    stockQty: 10,
    allowNegative: false,
  };
}

function rascunho(cart) {
  return {
    version: 1,
    updatedAt: '2026-08-31T01:40:00.000Z',
    saleMode: 'normal',
    cart,
    customer: null,
    discountInput: '0,00',
    payment: 'dinheiro',
    cardType: null,
    cashReceivedInput: '',
    creditEntryInput: '0,00',
    creditInstallments: 1,
    creditFirstDue: '',
    mixedDraft: null,
    deliveryAddr: {},
  };
}

beforeEach(() => {
  globalThis.localStorage.clear();
  avisos.length = 0;
});

test('TESTE 1: carrinho com 3 produtos sobrevive ao fechamento inesperado', () => {
  const draft = rascunho([linha('Produto A', 1, 1000), linha('Produto B', 2, 2500), linha('Produto C', 3, 500)]);
  saveDraft(draft);

  // "processo encerrado": só o armazenamento persiste
  const recuperado = loadPersistedDraft();
  assert.ok(recuperado, 'deve existir rascunho para oferecer recuperação');
  assert.equal(recuperado.cart.length, 3);
  assert.ok(hasOpenSaleContent(recuperado));
});

test('TESTE 2: recuperar traz os mesmos itens e quantidades', () => {
  const draft = rascunho([linha('Produto A', 1, 1000), linha('Produto B', 2, 2500), linha('Produto C', 3, 500)]);
  saveDraft(draft);

  const recuperado = loadPersistedDraft();
  assert.deepEqual(
    recuperado.cart.map((l) => [l.name, l.quantity, l.unitPriceCents]),
    [
      ['Produto A', 1, 1000],
      ['Produto B', 2, 2500],
      ['Produto C', 3, 500],
    ]
  );
});

test('TESTE 4: depois de concluir a venda o rascunho não é mais oferecido', () => {
  saveDraft(rascunho([linha('Produto A', 1, 1000)]));
  assert.ok(loadPersistedDraft());

  // resetSale() chama clearDraft() após a venda persistir
  clearDraft();
  assert.equal(loadPersistedDraft(), null);
});

test('TESTE 5: descartar deixa a venda vazia', () => {
  saveDraft(rascunho([linha('Produto A', 2, 1000)]));
  clearDraft();
  assert.equal(loadPersistedDraft(), null);
  assert.equal(hasOpenSaleContent(null), false);
});

test('TESTE 6: rascunho corrompido é ignorado e registrado, sem impedir a abertura', () => {
  globalThis.localStorage.setItem(CHAVE, '{"version":1,"cart":[{"name":"quebr');
  assert.equal(loadPersistedDraft(), null, 'JSON inválido não pode derrubar o PDV');
  assert.ok(avisos.some((a) => a.includes('corrompido')), 'erro deve ser registrado');
  assert.equal(globalThis.localStorage.getItem(CHAVE), null, 'rascunho inválido é descartado');

  avisos.length = 0;
  globalThis.localStorage.setItem(CHAVE, JSON.stringify({ version: 1, cart: [{ name: 123 }] }));
  assert.equal(loadPersistedDraft(), null, 'forma inválida também é recusada');
  assert.ok(avisos.some((a) => a.includes('inválido')));

  avisos.length = 0;
  globalThis.localStorage.setItem(CHAVE, JSON.stringify({ version: 99, cart: [] }));
  assert.equal(loadPersistedDraft(), null, 'versão desconhecida é recusada');
});

test('gravação usa chave temporária e não deixa sobra', () => {
  saveDraft(rascunho([linha('Produto A', 1, 1000)]));
  assert.equal(globalThis.localStorage.getItem('onca_pdv_open_sale_draft_v1.tmp'), null);
  assert.ok(globalThis.localStorage.getItem(CHAVE));
});

test('resumo mostra horário, itens e valor aproximado', () => {
  const draft = rascunho([linha('Produto A', 2, 1000), linha('Produto B', 1, 2500)]);
  const resumo = draftSummary(draft);
  assert.equal(resumo.itemCount, 2);
  assert.equal(resumo.unitCount, 3);
  assert.equal(resumo.approxTotalCents, 4500);
  assert.match(resumo.time, /^\d{2}:\d{2}$/);
});

test('rascunho vazio não é oferecido como recuperação', () => {
  const draft = rascunho([]);
  assert.equal(hasOpenSaleContent(draft), false);
  assert.equal(isValidDraftShape(draft), true, 'vazio é válido, apenas não tem conteúdo');
});
