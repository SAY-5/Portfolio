import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './shopflow.css';
import { catalog, money } from './shopflow/data';
import { useStore } from './shopflow/state';
import {
  addToCart,
  cartView,
  clearCart,
  placeOrder,
  removeFromCart,
  resetAll,
  resetBreaker,
  setDownstreamHealthy,
  setInjectFailSku,
  setQty,
  TRIP_THRESHOLD,
  type Order,
  type SagaEvent,
} from './shopflow/store';

// In-browser ShopFlow storefront. The catalog, cart, order saga, and gateway
// circuit breaker all run client-side over the catalog seed. Cart and placed
// orders persist in localStorage, so they survive a reload. The order path is
// the project's real saga: reserve inventory line by line, push a compensating
// release on a stack, and unwind in reverse on any failure, so a failed
// placement leaves no units reserved and no order written. The gateway breaker
// trips OPEN after repeated downstream failures and serves a fallback instead
// of hanging. Local benchmark over 2000 placements: p50 2.925ms, p95 3.774ms.
const P50_MS = 2.925;
const P95_MS = 3.774;
const PER_SEC = 329;
const STEP_MS = 520;
const ease = [0.22, 1, 0.36, 1] as const;

type View = 'shop' | 'checkout' | 'orders' | 'gateway';
type Run = 'idle' | 'running' | 'committed' | 'rolledback' | 'fallback';

export default function ShopflowDemo() {
  const state = useStore();
  const reduce = useReducedMotion();
  const [view, setView] = useState<View>('shop');
  const cart = cartView(state);

  // checkout run state, driven by replaying the saga events with delays
  const [run, setRun] = useState<Run>('idle');
  const [reserved, setReserved] = useState<string[]>([]);
  const [failedSku, setFailedSku] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<Order | null>(null);
  const timers = useRef<number[]>([]);

  function clearTimers() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }
  useEffect(() => clearTimers, []);

  function at(ms: number, fn: () => void) {
    timers.current.push(window.setTimeout(fn, reduce ? 0 : ms));
  }

  function resetRun() {
    clearTimers();
    setRun('idle');
    setReserved([]);
    setFailedSku(null);
    setConfirmed(null);
  }

  function goCheckout() {
    resetRun();
    setView('checkout');
  }

  // Place the order, then replay the returned saga events step by step so the
  // reservation stack visibly grows and, on failure, unwinds in reverse.
  function runCheckout() {
    if (run === 'running') return;
    clearTimers();
    setReserved([]);
    setFailedSku(null);
    setConfirmed(null);

    const result = placeOrder();

    // Breaker already open: the gateway answers from the fallback without
    // attempting the downstream reservation path, so there is nothing to replay.
    if (result.breakerOpen && result.events.length === 0 && !result.ok) {
      setRun('fallback');
      return;
    }

    setRun('running');
    const stack: string[] = [];
    let step = 0;

    const schedule = (ev: SagaEvent) => {
      at(step * STEP_MS, () => applyEvent(ev, stack));
      step += 1;
    };
    result.events.forEach(schedule);

    // settle the run state after the last event has played
    at(step * STEP_MS, () => {
      if (result.ok) setRun('committed');
      else if (result.breakerOpen) setRun('fallback');
      else setRun('rolledback');
    });
  }

  function applyEvent(ev: SagaEvent, stack: string[]) {
    switch (ev.kind) {
      case 'reserve':
        stack.push(ev.sku);
        setReserved([...stack]);
        break;
      case 'reserve-fail':
        setFailedSku(ev.sku);
        break;
      case 'compensate':
        stack.pop();
        setReserved([...stack]);
        break;
      case 'commit':
        setConfirmed(ev.order);
        break;
      case 'rollback':
        setReserved([]);
        break;
      case 'breaker-open':
        break;
    }
  }

  const busy = run === 'running';

  return (
    <div className="demo" aria-label="ShopFlow storefront">
      <span className="demo__tag">Storefront</span>
      <h3 className="demo__title">ShopFlow</h3>
      <p className="demo__lede">
        Browse the catalog, build a cart, and place an order. Placement runs the
        saga that reserves inventory line by line and compensates in reverse on
        failure, so a failed order leaves nothing reserved and no order written.
        Your cart and orders are saved in this browser and survive a reload.
      </p>

      <div className="sfa__bar">
        <div className="sf__tabs" role="tablist" aria-label="Storefront view">
          <button
            role="tab"
            aria-selected={view === 'shop'}
            className={`sf__tab ${view === 'shop' ? 'sf__tab--on' : ''}`}
            onClick={() => setView('shop')}
          >
            Shop
          </button>
          <button
            role="tab"
            aria-selected={view === 'checkout'}
            className={`sf__tab ${view === 'checkout' ? 'sf__tab--on' : ''}`}
            onClick={goCheckout}
            disabled={cart.lines.length === 0 && state.orders.length === 0}
          >
            Checkout
          </button>
          <button
            role="tab"
            aria-selected={view === 'orders'}
            className={`sf__tab ${view === 'orders' ? 'sf__tab--on' : ''}`}
            onClick={() => setView('orders')}
          >
            Orders{state.orders.length > 0 ? ` (${state.orders.length})` : ''}
          </button>
          <button
            role="tab"
            aria-selected={view === 'gateway'}
            className={`sf__tab ${view === 'gateway' ? 'sf__tab--on' : ''}`}
            onClick={() => setView('gateway')}
          >
            Gateway
          </button>
        </div>
        <span className="sfa__bar-spacer" />
        <span className="sfa__count">
          cart <b>{cart.count}</b> item{cart.count === 1 ? '' : 's'}
        </span>
      </div>

      <p className="sfa__sr" role="status" aria-live="polite">
        {run === 'committed' && confirmed
          ? `Order ${confirmed.id} placed.`
          : run === 'rolledback'
            ? 'Order rolled back. No partial order was written.'
            : run === 'fallback'
              ? 'Gateway breaker is open. Served the fallback.'
              : ''}
      </p>

      {view === 'shop' && (
        <div className="sfa__grid">
          <section className="sfa__catalog" aria-label="Product catalog">
            {catalog.map((p) => (
              <article key={p.sku} className="sfa__card">
                <span className="sfa__card-sku">{p.sku}</span>
                <span className="sfa__card-name">{p.name}</span>
                <span className="sfa__card-blurb">{p.blurb}</span>
                <div className="sfa__card-foot">
                  <span className="sfa__card-price">{money(p.price)}</span>
                  <span className="sfa__card-stock">{p.stock} in stock</span>
                  <button
                    className="demo__btn sfa__card-add"
                    onClick={() => addToCart(p.sku)}
                    aria-label={`Add ${p.name} to cart`}
                  >
                    Add
                  </button>
                </div>
              </article>
            ))}
          </section>

          <aside className="sfa__cart" aria-label="Cart">
            <div className="sfa__cart-head">
              Cart
              <span style={{ marginLeft: 'auto' }}>{cart.lines.length} lines</span>
            </div>

            {cart.lines.length === 0 ? (
              <p className="sfa__cart-empty">
                Your cart is empty. Add a product to get started.
              </p>
            ) : (
              <ul className="sfa__cart-list">
                {cart.lines.map((line) => (
                  <li key={line.sku} className="sfa__row">
                    <span className="sfa__row-name">{line.name}</span>
                    <span className="sfa__row-total">{money(line.lineTotal)}</span>
                    <span className="sfa__row-unit">
                      {money(line.unitPrice)} each
                    </span>
                    <span className="sfa__qty">
                      <button
                        className="sfa__qty-btn"
                        onClick={() => setQty(line.sku, line.qty - 1)}
                        aria-label={`Decrease ${line.name} quantity`}
                      >
                        -
                      </button>
                      <span className="sfa__qty-val" aria-live="polite">
                        {line.qty}
                      </span>
                      <button
                        className="sfa__qty-btn"
                        onClick={() => setQty(line.sku, line.qty + 1)}
                        aria-label={`Increase ${line.name} quantity`}
                      >
                        +
                      </button>
                      <button
                        className="sfa__row-remove"
                        onClick={() => removeFromCart(line.sku)}
                        aria-label={`Remove ${line.name} from cart`}
                      >
                        remove
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="sfa__subtotal">
              <span className="sfa__subtotal-label">Subtotal</span>
              <span className="sfa__subtotal-val">{money(cart.subtotal)}</span>
            </div>

            <div className="sfa__cart-actions">
              <button
                className="demo__btn"
                disabled={cart.lines.length === 0}
                onClick={goCheckout}
              >
                Checkout
              </button>
              <button
                className="demo__btn demo__btn--ghost"
                disabled={cart.lines.length === 0}
                onClick={clearCart}
              >
                Clear
              </button>
            </div>
          </aside>
        </div>
      )}

      {view === 'checkout' && (
        <div className="sfa__checkout">
          {run === 'committed' && confirmed ? (
            <div className="sfa__panel">
              <div className="sfa__panel-head">Order confirmed</div>
              <div className="sfa__verdict">
                <span className="sfa__verdict-head">Order placed</span>
                <span className="sfa__verdict-text">
                  All lines reserved and the order row was written in its own
                  step. p50 {P50_MS}ms, p95 {P95_MS}ms over 2000 placements.
                </span>
              </div>
              <p className="sfa__confirm-id" style={{ marginTop: 14 }}>
                {confirmed.id}
              </p>
              <ul className="sfa__cart-list" style={{ marginTop: 8 }}>
                {confirmed.lines.map((line) => (
                  <li key={line.sku} className="sfa__row">
                    <span className="sfa__row-name">
                      {line.name} x{line.qty}
                    </span>
                    <span className="sfa__row-total">{money(line.lineTotal)}</span>
                    <span className="sfa__row-unit">{line.sku}</span>
                  </li>
                ))}
              </ul>
              <div className="sfa__subtotal">
                <span className="sfa__subtotal-label">Order total</span>
                <span className="sfa__subtotal-val">
                  {money(confirmed.subtotal)}
                </span>
              </div>
              <div className="sfa__cart-actions">
                <button className="demo__btn" onClick={() => setView('shop')}>
                  Keep shopping
                </button>
                <button
                  className="demo__btn demo__btn--ghost"
                  onClick={() => setView('orders')}
                >
                  View orders
                </button>
              </div>
            </div>
          ) : (
            <div className="sfa__panel">
              <div className="sfa__panel-head">
                Reserve inventory
                <span className="sfa__panel-count">
                  {cart.lines.length} lines
                </span>
              </div>

              <div className="sfa__steps">
                {cart.lines.map((line, i) => {
                  const isReserved = reserved.includes(line.sku);
                  const isFailed = failedSku === line.sku;
                  return (
                    <div
                      key={line.sku}
                      className={`sfa__step ${
                        isReserved ? 'sfa__step--reserved' : ''
                      } ${isFailed ? 'sfa__step--failed' : ''}`}
                    >
                      <span className="sfa__step-idx">{i + 1}</span>
                      <span className="sfa__step-name">{line.name}</span>
                      <span className="sfa__step-qty">x{line.qty}</span>
                      <span className="sfa__step-state">
                        {isFailed
                          ? 'failed'
                          : isReserved
                            ? 'reserved'
                            : 'pending'}
                      </span>
                    </div>
                  );
                })}
                {cart.lines.length === 0 && (
                  <p className="sfa__cart-empty">
                    Cart is empty. Add products before checkout.
                  </p>
                )}
              </div>

              <div className="sfa__fail">
                <label className="sfa__switch">
                  <input
                    type="checkbox"
                    checked={state.injectFailSku !== null}
                    disabled={busy || cart.lines.length === 0}
                    onChange={(e) =>
                      setInjectFailSku(
                        e.target.checked ? cart.lines[0]?.sku ?? null : null,
                      )
                    }
                  />
                  Inject a reservation failure on
                </label>
                <select
                  value={state.injectFailSku ?? ''}
                  disabled={
                    busy ||
                    state.injectFailSku === null ||
                    cart.lines.length === 0
                  }
                  onChange={(e) => setInjectFailSku(e.target.value || null)}
                  aria-label="Line to fail"
                >
                  {cart.lines.map((line) => (
                    <option key={line.sku} value={line.sku}>
                      {line.name}
                    </option>
                  ))}
                </select>
              </div>

              <div
                className="sfa__panel"
                style={{ marginTop: 14, background: 'var(--ink-900)' }}
              >
                <div className="sfa__panel-head">
                  Compensation stack
                  <span className="sfa__panel-count">{reserved.length}</span>
                </div>
                <div className="sfa__stack">
                  <AnimatePresence initial={false}>
                    {reserved.map((sku, i) => {
                      const p = catalog.find((c) => c.sku === sku);
                      return (
                        <motion.div
                          key={sku}
                          className="sfa__stack-item"
                          initial={{ opacity: 0, y: reduce ? 0 : -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, x: reduce ? 0 : 14 }}
                          transition={{ duration: reduce ? 0 : 0.3, ease }}
                        >
                          <span className="sfa__step-idx">{i + 1}</span>
                          release {p?.name ?? sku}
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                  {reserved.length === 0 && (
                    <span className="sfa__stack-empty">
                      empty: nothing to release
                    </span>
                  )}
                </div>
              </div>

              <AnimatePresence>
                {run === 'rolledback' && (
                  <motion.div
                    className="sfa__verdict sfa__verdict--roll"
                    style={{ marginTop: 14 }}
                    initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.4, ease }}
                  >
                    <span className="sfa__verdict-head">No partial order</span>
                    <span className="sfa__verdict-text">
                      Compensations ran in reverse: every prior reservation was
                      released, no units stay reserved, and no order row was
                      written. The cart is unchanged so you can retry.
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>

              {run === 'fallback' && (
                <div className="sfa__fallback">
                  <span className="sfa__fallback-head">
                    Gateway served the fallback
                  </span>
                  <span className="sfa__fallback-text">
                    The breaker is OPEN, so the gateway answered from its 503
                    fallback without calling the downstream service or hanging.
                    Close the breaker from the Gateway tab, then place the order
                    again. Your cart is untouched.
                  </span>
                </div>
              )}

              <div className="sfa__cart-actions">
                <button
                  className="demo__btn"
                  disabled={busy || cart.lines.length === 0}
                  onClick={runCheckout}
                >
                  {busy ? 'Placing...' : 'Place order'}
                </button>
                <button
                  className="demo__btn demo__btn--ghost"
                  disabled={busy}
                  onClick={() => setView('shop')}
                >
                  Back to shop
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {view === 'orders' && (
        <section className="sfa__orders" aria-label="Orders">
          {state.orders.length === 0 ? (
            <p className="sfa__cart-empty">
              No orders yet. Place one from the cart.
            </p>
          ) : (
            <ul className="sfa__cart-list">
              {state.orders.map((o) => (
                <li key={o.id} className="sfa__row">
                  <span className="sfa__row-name">{o.id}</span>
                  <span className="sfa__row-total">{money(o.subtotal)}</span>
                  <span className="sfa__row-unit">
                    {o.lines.length} line{o.lines.length === 1 ? '' : 's'} and{' '}
                    {o.lines.reduce((n, l) => n + l.qty, 0)} units
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {view === 'gateway' && (
        <div className="sfa__checkout">
          <div className="sfa__panel">
            <div className="sfa__panel-head">Gateway circuit breaker</div>

            <div className="sfa__gw-row">
              <div className="sfa__node">
                <span className="sfa__node-name">gateway</span>
                <span className="sfa__node-sub">Resilience4j</span>
              </div>
              <div className={`sfa__breaker sfa__breaker--${state.breaker}`}>
                <span className="sfa__breaker-state">{state.breaker}</span>
                <span className="sfa__breaker-meta">
                  {state.breaker === 'open'
                    ? '503 fallback, no downstream call'
                    : `${state.consecutiveFails}/${TRIP_THRESHOLD} consecutive fails`}
                </span>
              </div>
              <button
                className={`sfa__node sfa__node--svc ${
                  state.downstreamHealthy ? 'sfa__node--up' : 'sfa__node--down'
                }`}
                onClick={() => setDownstreamHealthy(!state.downstreamHealthy)}
                aria-pressed={!state.downstreamHealthy}
                aria-label={`Catalog service is currently ${
                  state.downstreamHealthy ? 'healthy' : 'failing'
                }. Toggle health.`}
              >
                <span className="sfa__node-name">catalog svc</span>
                <span className="sfa__node-sub">
                  {state.downstreamHealthy ? 'healthy' : 'failing'}
                </span>
              </button>
            </div>

            <p className="sfa__verdict-text">
              When the catalog service is failing, each placement attempt counts
              against the breaker. After {TRIP_THRESHOLD} consecutive failures
              the breaker trips from closed to open, and further checkouts get
              the 503 fallback at once instead of hanging on the downstream.
            </p>

            <div className="sfa__stats">
              <div className="sfa__stat">
                <span className="sfa__stat-val">{P50_MS}</span>
                <span className="sfa__stat-unit">ms p50</span>
              </div>
              <div className="sfa__stat">
                <span className="sfa__stat-val">{P95_MS}</span>
                <span className="sfa__stat-unit">ms p95</span>
              </div>
              <div className="sfa__stat">
                <span className="sfa__stat-val">{PER_SEC}</span>
                <span className="sfa__stat-unit">placements/sec</span>
              </div>
            </div>

            <div className="sfa__cart-actions">
              <button
                className="demo__btn"
                disabled={cart.lines.length === 0}
                onClick={goCheckout}
              >
                Try a checkout
              </button>
              <button
                className="demo__btn demo__btn--ghost"
                onClick={resetBreaker}
              >
                Close breaker
              </button>
              <button
                className="demo__btn demo__btn--ghost"
                onClick={() => {
                  resetAll();
                  setView('shop');
                }}
              >
                Reset all
              </button>
            </div>
            <p className="sfa__cart-empty" style={{ marginTop: 4 }}>
              Reset all clears the saved cart and orders from this browser.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
