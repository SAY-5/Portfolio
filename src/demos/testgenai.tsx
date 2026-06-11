import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './testgenai.css';

// A feature spec feeds a prompt builder. Closed-schema tool calling returns
// structured (setup, steps, expected) test cases that stream in over SSE.
// v3 adds coverage analysis, duplicate detection, and quality scoring.

type Client = 'stub' | 'live';

// Coverage facets the analyzer tracks for this feature.
const FACETS = ['nominal', 'boundary', 'negative', 'timeout', 'failover'];

type TestCase = {
  id: string;
  title: string;
  setup: string;
  steps: string;
  expected: string;
  facet: string; // which coverage facet this case exercises
  quality: number; // 1..3 quality score from the scorer
  dupOf?: string; // set when the dedup pass flags it as a near-duplicate
};

// Deterministic cases the stub client emits, in stream order. The two BGP
// cases collide on the same facet so the dedup pass can flag the later one.
const CASES: TestCase[] = [
  {
    id: 'TC-01',
    title: 'OSPF neighbor reaches FULL',
    setup: 'two routers, area 0, matching MTU',
    steps: 'bring up link, wait for adjacency',
    expected: 'state FULL within 40s',
    facet: 'nominal',
    quality: 3,
  },
  {
    id: 'TC-02',
    title: 'OSPF rejects MTU mismatch',
    setup: 'routers with MTU 1500 vs 9000',
    steps: 'bring up link, observe DBD exchange',
    expected: 'adjacency stuck in EXSTART',
    facet: 'negative',
    quality: 3,
  },
  {
    id: 'TC-03',
    title: 'BGP session establishes',
    setup: 'eBGP peers, matching AS config',
    steps: 'configure neighbor, advertise route',
    expected: 'state ESTABLISHED, route in RIB',
    facet: 'nominal',
    quality: 2,
    dupOf: 'TC-01',
  },
  {
    id: 'TC-04',
    title: 'Hold timer expiry tears down',
    setup: 'established session, hold 9s',
    steps: 'drop keepalives, wait',
    expected: 'session reset after hold expiry',
    facet: 'timeout',
    quality: 3,
  },
  {
    id: 'TC-05',
    title: 'Failover to backup path',
    setup: 'primary and backup next-hop',
    steps: 'fail primary interface',
    expected: 'traffic reroutes under 1s',
    facet: 'failover',
    quality: 3,
  },
  {
    id: 'TC-06',
    title: 'Max prefix boundary',
    setup: 'peer with prefix-limit 4',
    steps: 'advertise the 5th prefix',
    expected: 'session closed, limit logged',
    facet: 'boundary',
    quality: 2,
  },
];

const ease = [0.22, 1, 0.36, 1] as const;

export default function TestgenaiDemo() {
  const reduce = useReducedMotion();
  const [client, setClient] = useState<Client>('stub');
  const [emitted, setEmitted] = useState(CASES.length);
  const [running, setRunning] = useState(false);
  const [collapseDups, setCollapseDups] = useState(true);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const streamed = CASES.slice(0, emitted);
  const complete = emitted >= CASES.length;

  // Coverage = distinct facets hit by non-duplicate cases, over total facets.
  const hitFacets = useMemo(() => {
    const set = new Set<string>();
    for (const c of streamed) if (!c.dupOf) set.add(c.facet);
    return set;
  }, [streamed]);
  const coverage = Math.round((hitFacets.size / FACETS.length) * 100);
  const dupCount = streamed.filter((c) => c.dupOf).length;

  const visibleCases = collapseDups ? streamed.filter((c) => !c.dupOf) : streamed;

  function generate() {
    if (running) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    setEmitted(0);
    setRunning(true);
    if (reduce) {
      setEmitted(CASES.length);
      setRunning(false);
      return;
    }
    let i = 0;
    const step = () => {
      i += 1;
      setEmitted(i);
      if (i >= CASES.length) {
        setRunning(false);
        timer.current = null;
        return;
      }
      timer.current = window.setTimeout(step, 560);
    };
    timer.current = window.setTimeout(step, 420);
  }

  return (
    <div className="demo" aria-label="testgenai case generator demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Spec to structured test cases</h3>
      <p className="demo__lede">
        A feature spec feeds the prompt builder. Closed-schema tool calling
        returns structured setup, steps, and expected tuples that stream in one
        at a time over SSE. A coverage meter fills as facets are hit, near
        duplicates get flagged, and a pyATS-style skeleton falls out at the end.
      </p>

      <div className="tg__stage">
        <div className="tg__panel">
          <div className="tg__panel-head">feature spec</div>
          <div className="tg__spec-line">
            <span className="tg__spec-key">feature: </span>
            <span className="tg__spec-val">routing_adjacency</span>
          </div>
          <div className="tg__spec-line">
            <span className="tg__spec-key">protocols: </span>
            <span className="tg__spec-val">ospf, bgp</span>
          </div>
          <div className="tg__spec-line">
            <span className="tg__spec-key">scope: </span>
            <span className="tg__spec-val">bring-up, teardown, failover</span>
          </div>

          <div className="tg__client" role="group" aria-label="client">
            <button
              className={`tg__client-chip ${client === 'stub' ? 'tg__client-chip--on' : ''}`}
              aria-pressed={client === 'stub'}
              onClick={() => !running && setClient('stub')}
            >
              stub client
            </button>
            <button
              className={`tg__client-chip ${client === 'live' ? 'tg__client-chip--on' : ''}`}
              aria-pressed={client === 'live'}
              onClick={() => !running && setClient('live')}
            >
              api client
            </button>
          </div>

          <div className="tg__coverage">
            <div className="tg__coverage-label">
              <span>coverage</span>
              <b>{coverage}%</b>
            </div>
            <div
              className="tg__coverage-track"
              role="progressbar"
              aria-valuenow={coverage}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <motion.div
                className="tg__coverage-bar"
                animate={{ width: `${coverage}%` }}
                transition={{ duration: reduce ? 0 : 0.45, ease }}
              />
            </div>
            <div className="tg__facets">
              {FACETS.map((f) => (
                <span key={f} className="tg__facet" data-hit={hitFacets.has(f)}>
                  {f}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="tg__panel">
          <div className="tg__panel-head">
            generated cases
            {running && (
              <span className="tg__panel-live">
                <motion.span
                  className="tg__panel-pulse"
                  animate={reduce ? {} : { opacity: [1, 0.3, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                />
                streaming
              </span>
            )}
          </div>
          <ul className="tg__cases">
            <AnimatePresence initial={false}>
              {visibleCases.map((c) => (
                <motion.li
                  key={c.id}
                  className="tg__case"
                  data-dup={!!c.dupOf}
                  layout={!reduce}
                  initial={{ opacity: 0, y: reduce ? 0 : 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduce ? 0 : 0.3, ease }}
                >
                  <div className="tg__case-top">
                    <span className="tg__case-id">{c.id}</span>
                    <span className="tg__tuple-val">{c.title}</span>
                    {c.dupOf ? (
                      <span className="tg__case-dupflag">dup of {c.dupOf}</span>
                    ) : (
                      <span className="tg__case-quality">
                        quality
                        <span className="tg__case-bars" aria-label={`quality ${c.quality} of 3`}>
                          {[1, 2, 3].map((n) => (
                            <span key={n} className="tg__case-bar" data-on={n <= c.quality} />
                          ))}
                        </span>
                      </span>
                    )}
                  </div>
                  <div className="tg__tuple">
                    <span className="tg__tuple-key">setup</span>
                    <span className="tg__tuple-val">{c.setup}</span>
                    <span className="tg__tuple-key">steps</span>
                    <span className="tg__tuple-val">{c.steps}</span>
                    <span className="tg__tuple-key">expected</span>
                    <span className="tg__tuple-val">{c.expected}</span>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>

          {complete && (
            <motion.pre
              className="tg__skel"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: reduce ? 0 : 0.4, ease }}
              aria-label="pyATS-style skeleton"
            >
              <span className="tg__skel-kw">class</span> RoutingAdjacency(aetest.Testcase):{'\n'}
              {'    '}
              <span className="tg__skel-kw">@aetest.test</span>
              {'\n'}
              {'    '}
              <span className="tg__skel-kw">def</span> ospf_neighbor_full(self):{'\n'}
              {'        '}
              <span className="tg__skel-kw">pass</span>
            </motion.pre>
          )}
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={generate} disabled={running}>
          {running ? 'Generating...' : complete ? 'Regenerate' : 'Generate cases'}
        </button>
        <button
          type="button"
          className={`tg__client-chip ${collapseDups ? 'tg__client-chip--on' : ''}`}
          aria-pressed={collapseDups}
          onClick={() => setCollapseDups((v) => !v)}
        >
          collapse duplicates
        </button>
        <span className="demo__hint">
          {streamed.length} cases
          {dupCount > 0 ? `, ${dupCount} flagged` : ''}
        </span>
      </div>

      <AnimatePresence>
        {complete && (
          <motion.div
            className="tg__verdict"
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease }}
          >
            <span className="tg__verdict-head">
              {coverage}% coverage, {dupCount} duplicate flagged
            </span>
            <span className="tg__verdict-text">
              The stub client emits these cases deterministically, so the flow
              runs offline with no API key; a real client plugs in via an env
              var. v3 scores quality, flags near duplicates, and reports facet
              coverage before emitting the nettestkit skeleton.
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
