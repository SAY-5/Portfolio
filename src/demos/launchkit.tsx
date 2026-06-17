import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './launchkit.css';
import { useStore } from './launchkit/state';
import {
  applyCheckout,
  cancelSubscription,
  createItem,
  currentAccount,
  currentSubscription,
  deleteItem,
  resetAll,
  signIn,
  signOut,
  signUp,
  tenantEvents,
  tenantItems,
  type AuthError,
  type Plan,
} from './launchkit/store';

// In-browser LaunchKit SaaS starter. The whole flow runs client-side over
// localStorage: sign up creates an account that is also a tenant and logs in,
// the dashboard shows only that tenant's rows through a TenantScope, billing
// upgrades the plan through a mock checkout whose event id makes a replay a
// no-op, and one in-product feature runs behind a provider seam with a
// deterministic in-browser stand-in. Sign out and a reset that clears storage
// round out the loop. Open the app in a second account to see the isolation.
const ease = [0.22, 1, 0.36, 1] as const;

type Screen = 'landing' | 'auth' | 'dashboard' | 'billing' | 'feature';

const PLAN_LABEL: Record<Plan, string> = {
  free: 'Free',
  active: 'Active',
  past_due: 'Past due',
  canceled: 'Canceled',
};

const AUTH_MESSAGE: Record<AuthError, string> = {
  email_taken: 'That email already has an account. Sign in instead.',
  invalid_credentials: 'Email or password did not match.',
  invalid_email: 'Enter a valid email address.',
  weak_password: 'Use a password of at least 8 characters.',
};

export default function LaunchkitDemo() {
  const state = useStore();
  const reduce = useReducedMotion();
  const signedIn = state.session !== null;
  const [screen, setScreen] = useState<Screen>(signedIn ? 'dashboard' : 'landing');

  // Keep the visible screen consistent with the session: a signed-out user can
  // only see landing or auth, a signed-in user lands on the dashboard.
  const effective: Screen = signedIn
    ? screen === 'landing' || screen === 'auth'
      ? 'dashboard'
      : screen
    : screen === 'auth'
      ? 'auth'
      : 'landing';

  const account = currentAccount(state);
  const subscription = currentSubscription(state);

  return (
    <div className="demo lk" aria-label="LaunchKit SaaS starter">
      <span className="demo__tag">Working app</span>
      <h3 className="demo__title">LaunchKit, a multi-tenant SaaS starter</h3>
      <p className="demo__lede">
        Sign up to create a tenant, reach a dashboard scoped to only your rows,
        upgrade billing through a mock checkout, and sign out. Everything
        persists in your browser. Open it again in a second account to see that
        each tenant sees only its own data.
      </p>

      {signedIn && account && (
        <nav className="lk__nav" aria-label="App sections">
          <div className="lk__nav-tabs" role="tablist">
            <NavTab
              label="Dashboard"
              active={effective === 'dashboard'}
              onClick={() => setScreen('dashboard')}
            />
            <NavTab
              label="Feature"
              active={effective === 'feature'}
              onClick={() => setScreen('feature')}
            />
            <NavTab
              label="Billing"
              active={effective === 'billing'}
              onClick={() => setScreen('billing')}
            />
          </div>
          <div className="lk__nav-account">
            <span className="lk__plan-pill" data-plan={subscription?.plan}>
              {PLAN_LABEL[subscription?.plan ?? 'free']}
            </span>
            <span className="lk__email" title={account.email}>
              {account.email}
            </span>
            <button
              type="button"
              className="demo__btn demo__btn--ghost lk__signout"
              onClick={() => {
                signOut();
                setScreen('landing');
              }}
            >
              Sign out
            </button>
          </div>
        </nav>
      )}

      <div className="lk__stage">
        <AnimatePresence mode="wait">
          <motion.div
            key={effective}
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduce ? 0 : -8 }}
            transition={{ duration: reduce ? 0 : 0.28, ease }}
          >
            {effective === 'landing' && (
              <Landing onStart={() => setScreen('auth')} />
            )}
            {effective === 'auth' && (
              <AuthScreen onBack={() => setScreen('landing')} />
            )}
            {effective === 'dashboard' && <Dashboard />}
            {effective === 'feature' && <FeatureScreen />}
            {effective === 'billing' && <Billing />}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={() => {
            resetAll();
            setScreen('landing');
          }}
        >
          Reset all data
        </button>
        <span className="demo__hint">
          accounts, rows, and billing persist in localStorage
        </span>
      </div>
    </div>
  );
}

function NavTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`lk__tab${active ? ' lk__tab--on' : ''}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

// ---------- landing ----------

function Landing({ onStart }: { onStart: () => void }) {
  const points = [
    'Email and password auth with a per-account session',
    'Tenant isolation: every row is scoped, cross-tenant reads return nothing',
    'Mock checkout with idempotent billing events',
    'One in-product feature behind a provider seam',
  ];
  return (
    <section className="lk__landing" aria-label="Overview">
      <div className="lk__hero">
        <h4 className="lk__hero-title">Ship the day-one pieces of a product</h4>
        <p className="lk__hero-sub">
          LaunchKit wires up the parts every new SaaS needs so you can start on
          the feature that matters. It runs entirely in your browser here.
        </p>
        <button type="button" className="demo__btn lk__cta" onClick={onStart}>
          Create an account
        </button>
      </div>
      <ul className="lk__points">
        {points.map((p) => (
          <li key={p} className="lk__point">
            <span className="lk__point-mark" aria-hidden="true">
              +
            </span>
            {p}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- auth ----------

function AuthScreen({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<'signup' | 'signin'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<AuthError | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const result =
      tab === 'signup' ? signUp(email, password) : signIn(email, password);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    // The shell re-renders into the dashboard once the session is set.
  }

  return (
    <section className="lk__auth" aria-label={tab === 'signup' ? 'Sign up' : 'Sign in'}>
      <div className="lk__tabs lk__tabs--auth" role="tablist" aria-label="Auth mode">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'signup'}
          className={`lk__tab${tab === 'signup' ? ' lk__tab--on' : ''}`}
          onClick={() => {
            setTab('signup');
            setError(null);
          }}
        >
          Sign up
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'signin'}
          className={`lk__tab${tab === 'signin' ? ' lk__tab--on' : ''}`}
          onClick={() => {
            setTab('signin');
            setError(null);
          }}
        >
          Sign in
        </button>
      </div>

      <form className="lk__form" onSubmit={submit} noValidate>
        <label className="lk__field">
          <span className="lk__label">Email</span>
          <input
            className="lk__input"
            type="email"
            name="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="lk__field">
          <span className="lk__label">Password</span>
          <input
            className="lk__input"
            type="password"
            name="password"
            autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
            placeholder="at least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {error && (
          <p className="lk__error" role="alert">
            {AUTH_MESSAGE[error]}
          </p>
        )}

        <div className="lk__form-actions">
          <button type="submit" className="demo__btn">
            {tab === 'signup' ? 'Create account' : 'Sign in'}
          </button>
          <button
            type="button"
            className="demo__btn demo__btn--ghost"
            onClick={onBack}
          >
            Back
          </button>
        </div>
      </form>
      <p className="lk__auth-note">
        Passwords are salted and hashed before storage, all in your browser. No
        data leaves this page.
      </p>
    </section>
  );
}

// ---------- dashboard ----------

function Dashboard() {
  const state = useStore();
  const items = tenantItems(state);
  const account = currentAccount(state);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (createItem(title, note)) {
      setTitle('');
      setNote('');
    }
  }

  return (
    <section className="lk__dash" aria-label="Dashboard">
      <header className="lk__dash-head">
        <div>
          <h4 className="lk__screen-title">Your workspace</h4>
          <p className="lk__screen-sub">
            Scoped to tenant{' '}
            <code className="lk__code">{account?.tenantId}</code>. These rows are
            invisible to every other account.
          </p>
        </div>
        <span className="lk__count" aria-label={`${items.length} items`}>
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </span>
      </header>

      <form className="lk__create" onSubmit={add}>
        <input
          className="lk__input"
          type="text"
          placeholder="New item title"
          aria-label="New item title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <input
          className="lk__input"
          type="text"
          placeholder="Optional note"
          aria-label="Optional note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button type="submit" className="demo__btn" disabled={!title.trim()}>
          Add
        </button>
      </form>

      <ul className="lk__items">
        <AnimatePresence initial={false}>
          {items.map((it) => (
            <motion.li
              key={it.id}
              className="lk__item"
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.22, ease }}
            >
              <div className="lk__item-main">
                <span className="lk__item-title">{it.title}</span>
                {it.note && <span className="lk__item-note">{it.note}</span>}
              </div>
              <code className="lk__item-id">{it.id}</code>
              <button
                type="button"
                className="lk__item-del"
                aria-label={`Delete ${it.title}`}
                onClick={() => deleteItem(it.id)}
              >
                Remove
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
        {items.length === 0 && (
          <li className="lk__empty">
            No items yet. Add one above. It belongs only to this tenant.
          </li>
        )}
      </ul>
    </section>
  );
}

// ---------- in-product feature behind a provider seam ----------

// A neutral provider interface. The default is a deterministic in-browser
// stand-in: same input always yields the same suggestions, no network. A real
// deployment would swap this for a hosted provider behind the same shape.
type SuggestProvider = {
  name: string;
  suggest: (title: string) => string[];
};

function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const localProvider: SuggestProvider = {
  name: 'local-stand-in',
  suggest(title: string) {
    const base = title.trim() || 'untitled';
    const verbs = ['Draft', 'Review', 'Schedule', 'Summarize', 'Assign', 'Archive'];
    const seed = hashString(base.toLowerCase());
    const out: string[] = [];
    for (let i = 0; i < 3; i++) {
      const verb = verbs[(seed + i * 7) % verbs.length];
      out.push(`${verb} "${base}"`);
    }
    return out;
  },
};

function FeatureScreen() {
  const [title, setTitle] = useState('');
  const [results, setResults] = useState<string[] | null>(null);
  const provider = localProvider;

  function run(e: React.FormEvent) {
    e.preventDefault();
    setResults(provider.suggest(title));
  }

  return (
    <section className="lk__feature" aria-label="In-product feature">
      <header className="lk__dash-head">
        <div>
          <h4 className="lk__screen-title">Task suggestions</h4>
          <p className="lk__screen-sub">
            Runs behind a provider seam. The default is a deterministic
            in-browser stand-in, so the same title always returns the same
            suggestions and nothing leaves the page.
          </p>
        </div>
        <span className="lk__provider-tag">provider: {provider.name}</span>
      </header>

      <form className="lk__create" onSubmit={run}>
        <input
          className="lk__input"
          type="text"
          placeholder="Describe a task, e.g. Quarterly report"
          aria-label="Task description"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <button type="submit" className="demo__btn" disabled={!title.trim()}>
          Suggest
        </button>
      </form>

      {results && (
        <ul className="lk__suggestions" aria-label="Suggestions">
          {results.map((r, i) => (
            <li key={`${r}-${i}`} className="lk__suggestion">
              {r}
            </li>
          ))}
        </ul>
      )}
      {!results && (
        <p className="lk__empty">
          Enter a task and the provider returns deterministic suggestions.
        </p>
      )}
    </section>
  );
}

// ---------- billing ----------

function Billing() {
  const state = useStore();
  const subscription = currentSubscription(state);
  const events = tenantEvents(state);
  const plan = subscription?.plan ?? 'free';

  // A single checkout event id, so the first click applies and any later click
  // is a replay that the idempotency ledger skips. The lazy initializer mints
  // it once per mount, away from the render path.
  const [eventId] = useState(() => `evt_${Math.random().toString(36).slice(2, 8)}`);
  const [lastReplay, setLastReplay] = useState<boolean | null>(null);

  function checkout() {
    const result = applyCheckout(eventId);
    if (result) setLastReplay(!result.applied);
  }

  return (
    <section className="lk__billing" aria-label="Billing">
      <header className="lk__dash-head">
        <div>
          <h4 className="lk__screen-title">Billing</h4>
          <p className="lk__screen-sub">
            Upgrade through a mock checkout. The checkout event has a stable id,
            so replaying it never applies the upgrade twice.
          </p>
        </div>
        <span className="lk__plan-pill lk__plan-pill--lg" data-plan={plan}>
          {PLAN_LABEL[plan]}
        </span>
      </header>

      <div className="lk__plans">
        <article className={`lk__plan${plan === 'free' ? ' lk__plan--current' : ''}`}>
          <h5 className="lk__plan-name">Free</h5>
          <p className="lk__plan-price">$0</p>
          <p className="lk__plan-desc">Starter limits, single workspace.</p>
        </article>
        <article
          className={`lk__plan${plan === 'active' ? ' lk__plan--current' : ''}`}
        >
          <h5 className="lk__plan-name">Pro</h5>
          <p className="lk__plan-price">$29</p>
          <p className="lk__plan-desc">Higher limits and the full feature set.</p>
        </article>
      </div>

      <div className="lk__billing-actions">
        {plan !== 'active' ? (
          <button type="button" className="demo__btn" onClick={checkout}>
            Upgrade to Pro
          </button>
        ) : (
          <>
            <button type="button" className="demo__btn" onClick={checkout}>
              Replay last checkout
            </button>
            <button
              type="button"
              className="demo__btn demo__btn--ghost"
              onClick={() => {
                cancelSubscription();
                setLastReplay(null);
              }}
            >
              Cancel subscription
            </button>
          </>
        )}
      </div>

      {lastReplay !== null && (
        <p
          className={`lk__billing-note${lastReplay ? ' lk__billing-note--skip' : ' lk__billing-note--ok'}`}
          role="status"
        >
          {lastReplay
            ? 'Replay skipped: the event id was already processed, so the plan did not move again.'
            : 'Checkout applied: the plan is now Pro.'}
        </p>
      )}

      <div className="lk__events">
        <div className="lk__events-head">Processed events</div>
        {events.length === 0 && (
          <p className="lk__empty">No checkout events yet.</p>
        )}
        {events.map((e) => (
          <div key={e.id} className="lk__event">
            <code className="lk__event-id">{e.id}</code>
            <span className="lk__event-kind">{e.kind}</span>
            <span className="lk__event-tag lk__event-tag--applied">applied</span>
          </div>
        ))}
      </div>
    </section>
  );
}
