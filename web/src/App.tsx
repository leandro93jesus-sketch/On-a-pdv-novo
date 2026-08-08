import { useEffect, useMemo, useState } from 'react';
import {
  createSale,
  fetchProducts,
  fetchSales,
  formatBRL,
  type Product,
  type Sale,
} from './api';

interface CartLine {
  product: Product;
  quantity: number;
}

const PAYMENT_METHODS = [
  { id: 'dinheiro', label: 'Dinheiro' },
  { id: 'cartao', label: 'Cartão' },
  { id: 'pix', label: 'Pix' },
];

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [payment, setPayment] = useState('dinheiro');
  const [error, setError] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const [p, s] = await Promise.all([fetchProducts(), fetchSales()]);
      setProducts(p);
      setSales(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const total = useMemo(
    () => cart.reduce((sum, line) => sum + line.product.price_cents * line.quantity, 0),
    [cart]
  );

  function addToCart(product: Product) {
    setLastSale(null);
    setCart((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (existing) {
        return prev.map((l) =>
          l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  }

  function changeQty(productId: number, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.product.id === productId ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0)
    );
  }

  function clearCart() {
    setCart([]);
  }

  async function checkout() {
    if (cart.length === 0) return;
    try {
      const sale = await createSale({
        payment_method: payment,
        items: cart.map((l) => ({ product_id: l.product.id, quantity: l.quantity })),
      });
      setLastSale(sale);
      setCart([]);
      setError(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao finalizar a venda');
    }
  }

  const categories = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of products) {
      const list = map.get(p.category) ?? [];
      list.push(p);
      map.set(p.category, list);
    }
    return [...map.entries()];
  }, [products]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">🛒</span>
          <div>
            <h1>On-a PDV</h1>
            <p>Ponto de Venda</p>
          </div>
        </div>
        <div className="topbar-status">{loading ? 'Carregando…' : `${products.length} produtos`}</div>
      </header>

      {error && <div className="banner banner-error">⚠️ {error}</div>}

      <main className="layout">
        <section className="catalog">
          {categories.map(([category, items]) => (
            <div key={category} className="category">
              <h2>{category}</h2>
              <div className="product-grid">
                {items.map((product) => (
                  <button
                    key={product.id}
                    className="product-card"
                    onClick={() => addToCart(product)}
                  >
                    <span className="product-name">{product.name}</span>
                    <span className="product-price">{formatBRL(product.price_cents)}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>

        <aside className="cart">
          <h2>Carrinho</h2>
          {cart.length === 0 ? (
            <p className="empty">Nenhum item. Toque em um produto para adicionar.</p>
          ) : (
            <ul className="cart-lines">
              {cart.map((line) => (
                <li key={line.product.id} className="cart-line">
                  <div className="cart-line-info">
                    <span className="cart-line-name">{line.product.name}</span>
                    <span className="cart-line-sub">
                      {formatBRL(line.product.price_cents)} × {line.quantity}
                    </span>
                  </div>
                  <div className="qty">
                    <button aria-label="Diminuir" onClick={() => changeQty(line.product.id, -1)}>
                      −
                    </button>
                    <span>{line.quantity}</span>
                    <button aria-label="Aumentar" onClick={() => changeQty(line.product.id, 1)}>
                      +
                    </button>
                  </div>
                  <span className="cart-line-total">
                    {formatBRL(line.product.price_cents * line.quantity)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="payment">
            <span>Pagamento</span>
            <div className="payment-options">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m.id}
                  className={m.id === payment ? 'chip chip-active' : 'chip'}
                  onClick={() => setPayment(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="total-row">
            <span>Total</span>
            <strong data-testid="cart-total">{formatBRL(total)}</strong>
          </div>

          <div className="cart-actions">
            <button className="btn btn-ghost" onClick={clearCart} disabled={cart.length === 0}>
              Limpar
            </button>
            <button className="btn btn-primary" onClick={checkout} disabled={cart.length === 0}>
              Finalizar Venda
            </button>
          </div>

          {lastSale && (
            <div className="receipt" data-testid="receipt">
              <h3>✅ Venda #{lastSale.id} concluída</h3>
              <p>
                {lastSale.items?.length} item(ns) · {formatBRL(lastSale.total_cents)} ·{' '}
                {lastSale.payment_method}
              </p>
            </div>
          )}
        </aside>
      </main>

      <section className="history">
        <h2>Últimas vendas</h2>
        {sales.length === 0 ? (
          <p className="empty">Ainda não há vendas registradas.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Data</th>
                <th>Pagamento</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => (
                <tr key={sale.id}>
                  <td>{sale.id}</td>
                  <td>{sale.created_at}</td>
                  <td>{sale.payment_method}</td>
                  <td>{formatBRL(sale.total_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
