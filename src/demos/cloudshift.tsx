import { useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './cloudshift.css';

// Real numbers from the project: a local run of 5000 requests after 1000 warmup
// measured a direct median of about 676us and a gateway median of about 1105us,
// so the facade adds about 429us (63%). The routing target is a single config
// value of MONOLITH or SERVICE, and the monolith receives every write in every
// phase so a rollback finds a complete view with each record present once.
const DIRECT_US = 676;
const GATEWAY_US = 1105;
const OVERHEAD_US = GATEWAY_US - DIRECT_US; // 429
const OVERHEAD_PCT = Math.round((OVERHEAD_US / DIRECT_US) * 100); // 63

type Target = 'MONOLITH' | 'SERVICE';

// Layout coordinates for the topology svg (viewBox 0 0 560 250).
const GW = { x: 250, y: 105 };
const MONO = { x: 430, y: 50 };
const SVC = { x: 430, y: 160 };
const ease = [0.22, 1, 0.36, 1] as const;

export default function CloudshiftDemo() {
  const reduce = useReducedMotion();
  const [target, setTarget] = useState<Target>('MONOLITH');
  const [diverged, setDiverged] = useState(false);
  const [pulse, setPulse] = useState(0);

  function flip(next: Target) {
    setTarget(next);
    setPulse((p) => p + 1);
  }

  function injectDivergence() {
    // Dual-write writes to both backends and compares stored records; a forced
    // mismatch surfaces as a divergence rather than being silently accepted.
    setDiverged(true);
    setPulse((p) => p + 1);
  }

  function reset() {
    setTarget('MONOLITH');
    setDiverged(false);
    setPulse(0);
  }

  // During migration both backends receive the write (dual-write). The active
  // read target is whichever the config points at.
  const dualWrite = true;
  const activeRead = target === 'MONOLITH' ? MONO : SVC;
  const phaseText =
    target === 'MONOLITH'
      ? 'reads served by the monolith'
      : 'reads served by the extracted service';

  return (
    <div className="demo" aria-label="cloudshift strangler-fig cutover demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Strangler-fig cutover, one route at a time</h3>
      <p className="demo__lede">
        The gateway routes the reservations path to exactly one backend from a
        config target. Flip the target to cut traffic over with no code change,
        watch dual-write hit both backends, and force a mismatch to see the
        consistency check surface it.
      </p>

      <div className="cs__stage">
        <div className="cs__toggle-row">
          <div
            className="cs__seg"
            role="radiogroup"
            aria-label="routing target for the reservations path"
          >
            <button
              type="button"
              role="radio"
              aria-checked={target === 'MONOLITH'}
              className={`cs__seg-btn${target === 'MONOLITH' ? ' cs__seg-btn--on' : ''}`}
              onClick={() => flip('MONOLITH')}
            >
              MONOLITH
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={target === 'SERVICE'}
              className={`cs__seg-btn${target === 'SERVICE' ? ' cs__seg-btn--on' : ''}`}
              onClick={() => flip('SERVICE')}
            >
              SERVICE
            </button>
          </div>
          <span className="cs__phase-label">
            target = <b>{target}</b>, {phaseText}
          </span>
        </div>

        <div className="cs__topo">
          <svg
            className="cs__svg"
            viewBox="0 0 560 250"
            role="group"
            aria-label="gateway routing topology"
          >
            <defs>
              <marker
                id="cs-arrow"
                viewBox="0 0 8 8"
                refX="6"
                refY="4"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 Z" fill="var(--accent)" />
              </marker>
              <marker
                id="cs-arrow-dim"
                viewBox="0 0 8 8"
                refX="6"
                refY="4"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 Z" fill="var(--line)" />
              </marker>
            </defs>

            {/* client to gateway */}
            <path
              d={`M 40 ${GW.y} L ${GW.x - 70} ${GW.y}`}
              stroke="var(--accent)"
              strokeWidth={1.6}
              fill="none"
              strokeOpacity={0.55}
              markerEnd="url(#cs-arrow)"
            />
            <text x={40} y={GW.y - 14} className="cs__box-sub">
              client traffic
            </text>

            {/* gateway to monolith write (always) */}
            <path
              d={`M ${GW.x + 70} ${GW.y} C 360 ${GW.y}, 360 ${MONO.y}, ${MONO.x - 6} ${MONO.y}`}
              stroke={target === 'MONOLITH' ? 'var(--accent)' : 'var(--line)'}
              strokeWidth={target === 'MONOLITH' ? 2 : 1.4}
              strokeOpacity={target === 'MONOLITH' ? 0.7 : 0.45}
              strokeDasharray={target === 'MONOLITH' ? undefined : '4 4'}
              fill="none"
              markerEnd={
                target === 'MONOLITH' ? 'url(#cs-arrow)' : 'url(#cs-arrow-dim)'
              }
            />
            {/* gateway to service */}
            <path
              d={`M ${GW.x + 70} ${GW.y} C 360 ${GW.y}, 360 ${SVC.y}, ${SVC.x - 6} ${SVC.y}`}
              stroke={target === 'SERVICE' ? 'var(--accent)' : 'var(--line)'}
              strokeWidth={target === 'SERVICE' ? 2 : 1.4}
              strokeOpacity={target === 'SERVICE' ? 0.7 : 0.45}
              strokeDasharray={target === 'SERVICE' ? undefined : '4 4'}
              fill="none"
              markerEnd={
                target === 'SERVICE' ? 'url(#cs-arrow)' : 'url(#cs-arrow-dim)'
              }
            />

            {/* dual-write indicator: a second arrow to the non-active backend */}
            {dualWrite && (
              <text x={332} y={102} className="cs__box-sub">
                dual-write
              </text>
            )}

            {/* request pulse along the active read route */}
            <AnimatePresence>
              <motion.circle
                key={`pulse-${pulse}-${target}`}
                r={5}
                fill="var(--accent-soft)"
                initial={
                  reduce
                    ? { cx: activeRead.x - 6, cy: activeRead.y, opacity: 1 }
                    : { cx: GW.x + 70, cy: GW.y, opacity: 0 }
                }
                animate={{
                  cx: activeRead.x - 6,
                  cy: activeRead.y,
                  opacity: [0, 1, 1, 0],
                }}
                transition={{ duration: reduce ? 0 : 0.85, ease }}
              />
            </AnimatePresence>

            {/* gateway box */}
            <g>
              <rect
                x={GW.x - 70}
                y={GW.y - 26}
                width={140}
                height={52}
                rx={10}
                fill="var(--accent-glow)"
                stroke="var(--accent)"
                strokeWidth={1.6}
              />
              <text
                x={GW.x}
                y={GW.y - 2}
                textAnchor="middle"
                className="cs__box-label"
              >
                gateway
              </text>
              <text
                x={GW.x}
                y={GW.y + 14}
                textAnchor="middle"
                className="cs__box-sub"
              >
                Spring Cloud Gateway
              </text>
            </g>

            {/* monolith box */}
            <g>
              <rect
                x={MONO.x - 6}
                y={MONO.y - 24}
                width={120}
                height={48}
                rx={9}
                fill={target === 'MONOLITH' ? 'var(--ink-700)' : 'var(--ink-850)'}
                stroke={
                  target === 'MONOLITH' ? 'var(--accent-line)' : 'var(--line)'
                }
                strokeWidth={1}
              />
              <text
                x={MONO.x + 54}
                y={MONO.y - 2}
                textAnchor="middle"
                className="cs__box-label"
              >
                monolith
              </text>
              <text
                x={MONO.x + 54}
                y={MONO.y + 13}
                textAnchor="middle"
                className="cs__box-sub"
              >
                writes every phase
              </text>
            </g>

            {/* service box */}
            <g>
              <rect
                x={SVC.x - 6}
                y={SVC.y - 24}
                width={120}
                height={48}
                rx={9}
                fill={target === 'SERVICE' ? 'var(--ink-700)' : 'var(--ink-850)'}
                stroke={
                  target === 'SERVICE' ? 'var(--accent-line)' : 'var(--line)'
                }
                strokeWidth={1}
              />
              <text
                x={SVC.x + 54}
                y={SVC.y - 2}
                textAnchor="middle"
                className="cs__box-label"
              >
                reservations
              </text>
              <text
                x={SVC.x + 54}
                y={SVC.y + 13}
                textAnchor="middle"
                className="cs__box-sub"
              >
                extracted service
              </text>
            </g>
          </svg>
        </div>

        <div className="cs__metrics">
          <div className="cs__metric">
            <div className="cs__metric-name">Direct median</div>
            <div className="cs__metric-val">
              {DIRECT_US}
              <span className="cs__metric-unit">us</span>
            </div>
            <div className="cs__metric-meta">backend without the facade</div>
          </div>
          <div className="cs__metric">
            <div className="cs__metric-name">Gateway median</div>
            <div className="cs__metric-val">
              {GATEWAY_US}
              <span className="cs__metric-unit">us</span>
            </div>
            <div className="cs__metric-meta">
              facade adds {OVERHEAD_US} us ({OVERHEAD_PCT}%)
            </div>
          </div>
          <div
            className={`cs__metric${diverged ? ' cs__metric--diverge' : ''}`}
          >
            <div className="cs__metric-name">Divergence</div>
            <div className="cs__metric-val">{diverged ? 1 : 0}</div>
            <div className="cs__metric-meta">
              {diverged
                ? 'records disagree, surfaced not swallowed'
                : 'dual-write records match'}
            </div>
          </div>
        </div>

        <AnimatePresence>
          {diverged && (
            <motion.div
              className="cs__verdict"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease }}
            >
              <span className="cs__verdict-head">Divergence surfaced</span>
              <span className="cs__verdict-text">
                Dual-write applied the reservation to both backends and compared
                the stored records. They disagree, so the check reports it
                instead of silently accepting. The monolith still holds every
                write, so a rollback finds a complete view with each record
                present once.
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button
          type="button"
          className="demo__btn"
          onClick={() => flip(target === 'MONOLITH' ? 'SERVICE' : 'MONOLITH')}
        >
          Cut over
        </button>
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={injectDivergence}
        >
          Force a mismatch
        </button>
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={reset}
        >
          Reset
        </button>
        <span className="demo__hint">cutover is one config change</span>
      </div>
    </div>
  );
}
