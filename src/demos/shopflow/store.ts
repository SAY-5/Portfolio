// Browser-side model of the ShopFlow order path. It keeps a cart in
// localStorage, places orders through a saga that reserves inventory line by
// line and compensates in reverse on any failure, and models the gateway
// circuit breaker that trips open after repeated downstream failures and serves
// a fallback instead of hanging. Nothing here talks to a server: the catalog
// stock acts as the inventory the saga reserves against.

import { catalog, findProduct, type Product } from './data';

const CART_KEY = 'shopflow.cart.v1';
const ORDERS_KEY = 'shopflow.orders.v1';

// Consecutive downstream failures that trip the gateway breaker OPEN, matching
// the Resilience4j sliding window threshold used in the service.
export const TRIP_THRESHOLD = 3;

export type CartItem = { sku: string; qty: number };

export type OrderLine = {
  sku: string;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
};

export type Order = {
  id: string;
  placedAt: number;
  lines: OrderLine[];
  subtotal: number;
};

// One step the saga emits as it runs, so the UI can show the reservation stack
// growing and unwinding without re-implementing the logic.
export type SagaEvent =
  | { kind: 'reserve'; sku: string; qty: number }
  | { kind: 'reserve-fail'; sku: string }
  | { kind: 'compensate'; sku: string }
  | { kind: 'commit'; order: Order }
  | { kind: 'rollback' }
  | { kind: 'breaker-open' };

export type SagaResult = {
  ok: boolean;
  order?: Order;
  events: SagaEvent[];
  breakerOpen: boolean;
};

export type BreakerState = 'closed' | 'open';

export type State = {
  cart: CartItem[];
  orders: Order[];
  breaker: BreakerState;
  consecutiveFails: number;
  // When true the placement path injects a failure on the chosen line so the
  // compensation unwind can be demonstrated.
  injectFailSku: string | null;
  // When true the downstream catalog service is modelled as failing, which
  // drives the breaker toward OPEN on each placement attempt.
  downstreamHealthy: boolean;
};

// ---------- persistence ----------

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage may be unavailable (private mode); the app still works in-memory.
  }
}

function loadState(): State {
  return {
    cart: readJSON<CartItem[]>(CART_KEY, []),
    orders: readJSON<Order[]>(ORDERS_KEY, []),
    breaker: 'closed',
    consecutiveFails: 0,
    injectFailSku: null,
    downstreamHealthy: true,
  };
}

// ---------- minimal external store ----------

let state: State = loadState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function set(next: Partial<State>): void {
  state = { ...state, ...next };
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): State {
  return state;
}

// ---------- cart actions ----------

export function addToCart(sku: string, qty = 1): void {
  if (!findProduct(sku)) return;
  const existing = state.cart.find((i) => i.sku === sku);
  let cart: CartItem[];
  if (existing) {
    cart = state.cart.map((i) =>
      i.sku === sku ? { ...i, qty: i.qty + qty } : i,
    );
  } else {
    cart = [...state.cart, { sku, qty }];
  }
  writeJSON(CART_KEY, cart);
  set({ cart });
}

export function setQty(sku: string, qty: number): void {
  const clamped = Math.max(0, Math.floor(qty));
  if (clamped === 0) {
    removeFromCart(sku);
    return;
  }
  const cart = state.cart.map((i) => (i.sku === sku ? { ...i, qty: clamped } : i));
  writeJSON(CART_KEY, cart);
  set({ cart });
}

export function removeFromCart(sku: string): void {
  const cart = state.cart.filter((i) => i.sku !== sku);
  writeJSON(CART_KEY, cart);
  set({ cart });
}

export function clearCart(): void {
  writeJSON(CART_KEY, []);
  set({ cart: [] });
}

// ---------- toggles ----------

export function setInjectFailSku(sku: string | null): void {
  set({ injectFailSku: sku });
}

export function setDownstreamHealthy(healthy: boolean): void {
  set({ downstreamHealthy: healthy });
}

export function resetBreaker(): void {
  set({ breaker: 'closed', consecutiveFails: 0 });
}

// Wipe persisted cart and orders and reset the runtime model.
export function resetAll(): void {
  try {
    localStorage.removeItem(CART_KEY);
    localStorage.removeItem(ORDERS_KEY);
  } catch {
    // ignore storage errors
  }
  state = {
    cart: [],
    orders: [],
    breaker: 'closed',
    consecutiveFails: 0,
    injectFailSku: null,
    downstreamHealthy: true,
  };
  emit();
}

// ---------- derived ----------

export type CartView = {
  lines: OrderLine[];
  subtotal: number;
  count: number;
};

export function cartView(s: State = state): CartView {
  const lines: OrderLine[] = [];
  let subtotal = 0;
  let count = 0;
  for (const item of s.cart) {
    const p = findProduct(item.sku);
    if (!p) continue;
    const lineTotal = p.price * item.qty;
    subtotal += lineTotal;
    count += item.qty;
    lines.push({
      sku: p.sku,
      name: p.name,
      qty: item.qty,
      unitPrice: p.price,
      lineTotal,
    });
  }
  return { lines, subtotal, count };
}

// ---------- order id ----------

function makeOrderId(): string {
  const n = Math.floor(Math.random() * 1_000_000)
    .toString(36)
    .toUpperCase()
    .padStart(4, '0');
  return `SF-${n}`;
}

// ---------- the order saga ----------

// Reserve each cart line in turn, pushing a compensating release onto a stack.
// If a reservation fails (injected on a chosen line), pop the stack in reverse
// and release every prior reservation, so no units stay reserved and no order
// row is written. On success the order is written in its own step and cleared
// from the cart. This is a synchronous model of the distributed saga; the UI
// replays the returned events with delays for the step-by-step view.
export function placeOrder(): SagaResult {
  const events: SagaEvent[] = [];
  const view = cartView();

  if (view.lines.length === 0) {
    return { ok: false, events, breakerOpen: getState().breaker === 'open' };
  }

  // Gateway breaker: if already open, serve the fallback and do not attempt the
  // downstream reservation path at all.
  if (state.breaker === 'open') {
    return { ok: false, events, breakerOpen: true };
  }

  const failSku = state.injectFailSku;
  const compensation: { sku: string; qty: number }[] = [];

  for (const line of view.lines) {
    const injected = failSku !== null && failSku === line.sku;
    const downstreamDown = !state.downstreamHealthy;

    if (injected || downstreamDown) {
      // Reservation failed at this line. Begin compensating in reverse.
      events.push({ kind: 'reserve-fail', sku: line.sku });
      for (let i = compensation.length - 1; i >= 0; i--) {
        events.push({ kind: 'compensate', sku: compensation[i].sku });
      }
      events.push({ kind: 'rollback' });

      // A downstream failure also counts against the breaker. Injected
      // single-line failures are a business rollback, not a downstream outage,
      // so they do not move the breaker.
      if (downstreamDown) {
        const fails = state.consecutiveFails + 1;
        const open = fails >= TRIP_THRESHOLD;
        if (open) events.push({ kind: 'breaker-open' });
        set({
          consecutiveFails: fails,
          breaker: open ? 'open' : state.breaker,
        });
      }
      return { ok: false, events, breakerOpen: getState().breaker === 'open' };
    }

    // Reservation held: push the compensating release onto the stack.
    compensation.push({ sku: line.sku, qty: line.qty });
    events.push({ kind: 'reserve', sku: line.sku, qty: line.qty });
  }

  // All lines reserved. Write the order in its own step.
  const order: Order = {
    id: makeOrderId(),
    placedAt: Date.now(),
    lines: view.lines,
    subtotal: view.subtotal,
  };
  events.push({ kind: 'commit', order });

  const orders = [order, ...state.orders];
  writeJSON(ORDERS_KEY, orders);
  writeJSON(CART_KEY, []);
  // A healthy placement closes the breaker failure streak.
  set({ orders, cart: [], consecutiveFails: 0 });

  return { ok: true, order, events, breakerOpen: false };
}

export { catalog };
export type { Product };
