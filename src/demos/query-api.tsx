import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './query-api.css';

// Real mechanism from the project. The recent-orders endpoint replaced a naive
// 1 + N + N*M query pattern with two fan-in queries, asserted by
// QueryCountIntegrationTest. The explain-check CI job fails the build when a
// Seq Scan appears over a table larger than 1000 rows. Numbers shown are from
// the project: a load run reached ~1,426-1,447 achieved rps against a 1,500
// target with 0 errors, and the smoke gate holds 200 rps at P50 2.2 ms.

const N = 4; // orders fetched
const M = 3; // line items per order
const NAIVE = 1 + N + N * M; // 1 + 4 + 12 = 17
const TUNED = 2;

type Endpoint = {
  id: string;
  method: string;
  path: string;
  plan: PlanNode;
  seqScan: boolean;
  table: string;
};

type PlanNode = {
  op: string;
  detail: string;
  cost: string;
  seq?: boolean;
  children?: PlanNode[];
};

const ENDPOINTS: Endpoint[] = [
  {
    id: 'recent-orders',
    method: 'GET',
    path: '/orders/recent',
    table: 'orders',
    seqScan: false,
    plan: {
      op: 'Limit',
      detail: 'rows=50',
      cost: '0.4 ms',
      children: [
        {
          op: 'Index Scan Backward',
          detail: 'orders_created_at_idx',
          cost: '0.3 ms',
          children: [
            {
              op: 'Hash Join',
              detail: 'order_lines on order_id',
              cost: '0.2 ms',
            },
          ],
        },
      ],
    },
  },
  {
    id: 'order-by-id',
    method: 'GET',
    path: '/orders/{id}',
    table: 'orders',
    seqScan: false,
    plan: {
      op: 'Index Scan',
      detail: 'orders_pkey',
      cost: '0.1 ms',
      children: [
        {
          op: 'Index Scan',
          detail: 'order_lines_order_id_idx',
          cost: '0.1 ms',
        },
      ],
    },
  },
  {
    id: 'customer-summary',
    method: 'GET',
    path: '/customers/{id}/summary',
    table: 'order_summary_mv',
    seqScan: false,
    plan: {
      op: 'Index Scan',
      detail: 'order_summary_mv_customer_idx',
      cost: '0.2 ms',
      children: [
        {
          op: 'Materialized View',
          detail: 'order_summary_mv',
          cost: 'precomputed',
        },
      ],
    },
  },
  {
    id: 'order-search',
    method: 'GET',
    path: '/orders/search',
    table: 'orders',
    seqScan: true,
    plan: {
      op: 'Gather',
      detail: 'workers=2',
      cost: '210 ms',
      children: [
        {
          op: 'Seq Scan',
          detail: 'orders (filter: status = ?)',
          cost: '208 ms',
          seq: true,
        },
      ],
    },
  },
];

const ease = [0.22, 1, 0.36, 1] as const;

function PlanTree({ node, depth }: { node: PlanNode; depth: number }) {
  return (
    <div className="qa__plan-node" style={{ marginLeft: depth ? 18 : 0 }}>
      <div className={`qa__plan-line ${node.seq ? 'qa__plan-line--seq' : ''}`}>
        <span className="qa__plan-arrow" aria-hidden="true">
          {depth ? '->' : ''}
        </span>
        <span className="qa__plan-op">{node.op}</span>
        <span className="qa__plan-detail">{node.detail}</span>
        <span className="qa__plan-cost">{node.cost}</span>
      </div>
      {node.children?.map((c, i) => (
        <PlanTree key={i} node={c} depth={depth + 1} />
      ))}
    </div>
  );
}

export default function QueryApiDemo() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const [collapsed, setCollapsed] = useState(false); // N+1 trap collapsed to 2 queries
  const [animating, setAnimating] = useState(false);
  const [queryCount, setQueryCount] = useState(NAIVE);
  const timer = useRef<number | null>(null);

  const ep = ENDPOINTS[active];

  function stop() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }
  useEffect(() => stop, []);

  function selectEndpoint(i: number) {
    if (animating) return;
    setActive(i);
  }

  function collapse() {
    if (animating) return;
    if (collapsed) {
      // reset back to the naive pattern
      setCollapsed(false);
      setQueryCount(NAIVE);
      return;
    }
    setAnimating(true);
    if (reduce) {
      setQueryCount(TUNED);
      setCollapsed(true);
      setAnimating(false);
      return;
    }
    // Count down query by query as the fan-in replaces the loop.
    let c = NAIVE;
    const step = () => {
      c -= 1;
      setQueryCount(Math.max(TUNED, c));
      if (c <= TUNED) {
        setCollapsed(true);
        setAnimating(false);
        timer.current = null;
        return;
      }
      timer.current = window.setTimeout(step, 90);
    };
    timer.current = window.setTimeout(step, 120);
  }

  // The recent-orders endpoint is the one that carries the N+1 study.
  const isStudy = ep.id === 'recent-orders';
  const passing = !ep.seqScan;

  return (
    <div className="demo" aria-label="query-api explain plan demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Committed plans, asserted query counts</h3>
      <p className="demo__lede">
        Every endpoint ships a committed EXPLAIN plan and a query-count
        assertion. Pick an endpoint to read its plan tree, then collapse the
        recent-orders N+1 trap from {NAIVE} queries down to {TUNED} fan-in queries
        and watch the assertion turn green. The explain-check CI job fails the
        build when a Seq Scan appears over a table larger than 1000 rows.
      </p>

      <div className="qa__tabs" role="tablist" aria-label="endpoints">
        {ENDPOINTS.map((e, i) => (
          <button
            key={e.id}
            role="tab"
            aria-selected={i === active}
            className={`qa__tab ${i === active ? 'qa__tab--on' : ''} ${
              e.seqScan ? 'qa__tab--warn' : ''
            }`}
            onClick={() => selectEndpoint(i)}
          >
            <span className="qa__tab-method">{e.method}</span>
            {e.path}
          </button>
        ))}
      </div>

      <div className="qa__panel">
        <div className="qa__plan">
          <div className="qa__plan-head">
            <span>EXPLAIN (ANALYZE, BUFFERS)</span>
            <span
              className={`qa__gate ${passing ? 'qa__gate--ok' : 'qa__gate--fail'}`}
            >
              {passing ? 'explain-check pass' : 'explain-check fail'}
            </span>
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={ep.id}
              initial={{ opacity: 0, y: reduce ? 0 : 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduce ? 0 : -6 }}
              transition={{ duration: reduce ? 0 : 0.25, ease }}
            >
              <PlanTree node={ep.plan} depth={0} />
            </motion.div>
          </AnimatePresence>
          {ep.seqScan && (
            <p className="qa__plan-warn">
              Seq Scan over {ep.table} (more than 1000 rows). CI blocks this
              plan until an index or rewrite removes the scan.
            </p>
          )}
        </div>
      </div>

      {isStudy && (
        <div className="qa__study">
          <div className="qa__queries">
            <div className="qa__queries-head">
              <span>recent-orders query pattern</span>
              <span
                className={`qa__assert ${collapsed ? 'qa__assert--ok' : 'qa__assert--pending'}`}
              >
                QueryCountIntegrationTest:{' '}
                {collapsed ? 'assertEquals(2) pass' : `${queryCount} queries`}
              </span>
            </div>

            <div className="qa__count-row">
              <div className="qa__count-num" aria-live="polite">
                {queryCount}
              </div>
              <div className="qa__count-formula">
                {collapsed ? (
                  <span className="qa__count-tuned">
                    one orders query + one fan-in line-items query
                  </span>
                ) : (
                  <>
                    <b>1</b> orders + <b>{N}</b> per-order +{' '}
                    <b>{N * M}</b> per-line lookups
                  </>
                )}
              </div>
            </div>

            <ul className="qa__bars" aria-hidden="true">
              {Array.from({ length: NAIVE }).map((_, i) => {
                const gone = collapsed ? i >= TUNED : i >= queryCount;
                return (
                  <motion.li
                    key={i}
                    className={`qa__bar ${gone ? 'qa__bar--gone' : ''} ${
                      i < TUNED ? 'qa__bar--keep' : ''
                    }`}
                    initial={false}
                    animate={{
                      opacity: gone ? 0.18 : 1,
                      scaleY: gone ? 0.4 : 1,
                    }}
                    transition={{ duration: reduce ? 0 : 0.25, ease }}
                  />
                );
              })}
            </ul>
          </div>
        </div>
      )}

      <div className="qa__stats">
        <div className="qa__stat">
          <div className="qa__stat-val">1,447</div>
          <div className="qa__stat-unit">achieved rps (1,500 target)</div>
        </div>
        <div className="qa__stat">
          <div className="qa__stat-val">0</div>
          <div className="qa__stat-unit">errors on the load run</div>
        </div>
        <div className="qa__stat">
          <div className="qa__stat-val">2.2 ms</div>
          <div className="qa__stat-unit">P50 at the 200 rps smoke gate</div>
        </div>
      </div>

      <div className="demo__controls">
        {isStudy ? (
          <button className="demo__btn" onClick={collapse} disabled={animating}>
            {animating
              ? 'Collapsing…'
              : collapsed
                ? 'Show the N+1 trap'
                : 'Collapse to two queries'}
          </button>
        ) : (
          <button
            className="demo__btn"
            onClick={() => selectEndpoint(0)}
            disabled={animating}
          >
            See the N+1 study
          </button>
        )}
        <span className="demo__hint">
          Honest finding: virtual threads did not win here because HikariCP caps
          concurrent DB calls, so the Tomcat pool stayed cheaper.
        </span>
      </div>
    </div>
  );
}
