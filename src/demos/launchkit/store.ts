// Browser-side model of the LaunchKit SaaS starter. Everything runs client-side
// over localStorage: account sign up and sign in, a current session, per-tenant
// data scoped so one account never sees another's rows, a subscription that
// moves between free, active, past_due, and canceled, and a mock checkout that
// applies its transition exactly once even when the same event is replayed.
//
// Nothing here talks to a server and there are no secrets. Each account is its
// own tenant; a TenantScope on every read and write injects the active tenant
// filter and re-checks ownership, so a row created under one account is
// invisible and unwritable from another.

const ACCOUNTS_KEY = 'launchkit.accounts.v1';
const SESSION_KEY = 'launchkit.session.v1';
const ITEMS_KEY = 'launchkit.items.v1';
const SUBS_KEY = 'launchkit.subscriptions.v1';
const EVENTS_KEY = 'launchkit.events.v1';

export type Plan = 'free' | 'active' | 'past_due' | 'canceled';

// An account is also a tenant: its id scopes every row it owns.
export type Account = {
  tenantId: string;
  email: string;
  // A salted, iterated digest of the password. Never the password itself.
  passwordHash: string;
  createdAt: number;
};

export type Item = {
  id: string;
  tenantId: string;
  title: string;
  note: string;
  createdAt: number;
};

export type Subscription = {
  tenantId: string;
  plan: Plan;
  // The last checkout event applied to this tenant, used to reflect billing
  // history in the UI.
  lastEventId: string | null;
  updatedAt: number;
};

// A processed checkout event. The id is the idempotency key: a replay of the
// same id is recognised here and never re-applied.
export type BillingEvent = {
  id: string;
  tenantId: string;
  kind: 'checkout.completed' | 'subscription.canceled';
  appliedAt: number;
};

export type Session = { tenantId: string } | null;

export type AuthError = 'email_taken' | 'invalid_credentials' | 'invalid_email' | 'weak_password';

export type AuthResult =
  | { ok: true; tenantId: string }
  | { ok: false; error: AuthError };

export type State = {
  accounts: Account[];
  session: Session;
  items: Item[];
  subscriptions: Subscription[];
  events: BillingEvent[];
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
    accounts: readJSON<Account[]>(ACCOUNTS_KEY, []),
    session: readJSON<Session>(SESSION_KEY, null),
    items: readJSON<Item[]>(ITEMS_KEY, []),
    subscriptions: readJSON<Subscription[]>(SUBS_KEY, []),
    events: readJSON<BillingEvent[]>(EVENTS_KEY, []),
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

// ---------- ids and hashing ----------

function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const time = Date.now().toString(36).slice(-4);
  return `${prefix}_${time}${rand}`;
}

// A deterministic, salted, iterated digest. This is a demonstration hash, not a
// production KDF, but it never stores the raw password and a replayed sign in
// must reproduce the same digest to match.
function hashPassword(password: string, salt: string): string {
  let h = 0x811c9dc5;
  const input = `${salt}:${password}`;
  for (let round = 0; round < 64; round++) {
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= round;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const SALT = 'launchkit.v1';

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---------- auth ----------

export function signUp(emailRaw: string, password: string): AuthResult {
  const email = emailRaw.trim().toLowerCase();
  if (!isValidEmail(email)) return { ok: false, error: 'invalid_email' };
  if (password.length < 8) return { ok: false, error: 'weak_password' };
  if (state.accounts.some((a) => a.email === email)) {
    return { ok: false, error: 'email_taken' };
  }

  const account: Account = {
    tenantId: makeId('ten'),
    email,
    passwordHash: hashPassword(password, SALT),
    createdAt: Date.now(),
  };
  const accounts = [...state.accounts, account];

  // Every new tenant starts on the free plan.
  const subscription: Subscription = {
    tenantId: account.tenantId,
    plan: 'free',
    lastEventId: null,
    updatedAt: Date.now(),
  };
  const subscriptions = [...state.subscriptions, subscription];
  const session: Session = { tenantId: account.tenantId };

  writeJSON(ACCOUNTS_KEY, accounts);
  writeJSON(SUBS_KEY, subscriptions);
  writeJSON(SESSION_KEY, session);
  set({ accounts, subscriptions, session });
  return { ok: true, tenantId: account.tenantId };
}

export function signIn(emailRaw: string, password: string): AuthResult {
  const email = emailRaw.trim().toLowerCase();
  const account = state.accounts.find((a) => a.email === email);
  if (!account || account.passwordHash !== hashPassword(password, SALT)) {
    return { ok: false, error: 'invalid_credentials' };
  }
  const session: Session = { tenantId: account.tenantId };
  writeJSON(SESSION_KEY, session);
  set({ session });
  return { ok: true, tenantId: account.tenantId };
}

export function signOut(): void {
  writeJSON(SESSION_KEY, null);
  set({ session: null });
}

// ---------- session-derived selectors ----------

export function currentAccount(s: State = state): Account | null {
  if (!s.session) return null;
  return s.accounts.find((a) => a.tenantId === s.session?.tenantId) ?? null;
}

export function currentSubscription(s: State = state): Subscription | null {
  if (!s.session) return null;
  return (
    s.subscriptions.find((sub) => sub.tenantId === s.session?.tenantId) ?? null
  );
}

// TenantScope: every item read goes through here so a query can only ever see
// the active tenant's rows. With no session it returns nothing.
export function tenantItems(s: State = state): Item[] {
  if (!s.session) return [];
  const tid = s.session.tenantId;
  return s.items
    .filter((it) => it.tenantId === tid)
    .sort((a, b) => b.createdAt - a.createdAt);
}

// ---------- tenant-scoped data actions ----------

export function createItem(title: string, note: string): Item | null {
  if (!state.session) return null;
  const trimmed = title.trim();
  if (!trimmed) return null;
  const item: Item = {
    id: makeId('item'),
    tenantId: state.session.tenantId,
    title: trimmed,
    note: note.trim(),
    createdAt: Date.now(),
  };
  const items = [...state.items, item];
  writeJSON(ITEMS_KEY, items);
  set({ items });
  return item;
}

export function deleteItem(id: string): void {
  if (!state.session) return;
  const tid = state.session.tenantId;
  // Ownership re-check: a delete only touches a row inside the active tenant.
  const items = state.items.filter(
    (it) => !(it.id === id && it.tenantId === tid),
  );
  writeJSON(ITEMS_KEY, items);
  set({ items });
}

// ---------- billing ----------

export type CheckoutResult = {
  applied: boolean; // false means the event was a replay and was skipped
  plan: Plan;
  eventId: string;
};

// Apply a mock checkout for the active tenant. The eventId is the idempotency
// key. If an event with that id was already processed for this tenant, the
// transition is not re-applied, so replaying the same delivery never moves the
// plan twice. Passing no id mints a fresh one, modelling a brand new delivery.
export function applyCheckout(eventId?: string): CheckoutResult | null {
  if (!state.session) return null;
  const tid = state.session.tenantId;
  const id = eventId ?? makeId('evt');

  const already = state.events.some(
    (e) => e.id === id && e.tenantId === tid,
  );
  const sub = currentSubscription();
  const currentPlan = sub?.plan ?? 'free';

  if (already) {
    // Replay: the processed-events ledger already has this id, so nothing moves.
    return { applied: false, plan: currentPlan, eventId: id };
  }

  const event: BillingEvent = {
    id,
    tenantId: tid,
    kind: 'checkout.completed',
    appliedAt: Date.now(),
  };
  const events = [...state.events, event];

  const subscriptions = state.subscriptions.map((s) =>
    s.tenantId === tid
      ? { ...s, plan: 'active' as Plan, lastEventId: id, updatedAt: Date.now() }
      : s,
  );

  writeJSON(EVENTS_KEY, events);
  writeJSON(SUBS_KEY, subscriptions);
  set({ events, subscriptions });
  return { applied: true, plan: 'active', eventId: id };
}

export function cancelSubscription(): void {
  if (!state.session) return;
  const tid = state.session.tenantId;
  const subscriptions = state.subscriptions.map((s) =>
    s.tenantId === tid
      ? { ...s, plan: 'canceled' as Plan, updatedAt: Date.now() }
      : s,
  );
  writeJSON(SUBS_KEY, subscriptions);
  set({ subscriptions });
}

export function tenantEvents(s: State = state): BillingEvent[] {
  if (!s.session) return [];
  const tid = s.session.tenantId;
  return s.events
    .filter((e) => e.tenantId === tid)
    .sort((a, b) => b.appliedAt - a.appliedAt);
}

// ---------- reset ----------

// Wipe every persisted LaunchKit key and reset the runtime model to empty.
export function resetAll(): void {
  for (const key of [ACCOUNTS_KEY, SESSION_KEY, ITEMS_KEY, SUBS_KEY, EVENTS_KEY]) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore storage errors
    }
  }
  state = {
    accounts: [],
    session: null,
    items: [],
    subscriptions: [],
    events: [],
  };
  emit();
}

export { hashPassword, isValidEmail, makeId };
