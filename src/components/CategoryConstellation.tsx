import { motion, useReducedMotion } from 'framer-motion';
import { categoryBuckets, totalProjects } from '../data/stats';

const ease = [0.22, 1, 0.36, 1] as const;

// Short labels for the constellation nodes.
const SHORT: Record<string, string> = {
  'Agents and Language': 'Agents',
  'Infra and Distributed': 'Infra',
  'Data and ML': 'Data / ML',
  'Web and Full-stack': 'Web',
  'Systems and C++': 'Systems',
  'Developer Tools': 'Dev Tools',
  'Instrumentation and Test': 'Instr.',
  Other: 'Other',
};

const SIZE = 460;
const CENTER = SIZE / 2;

export default function CategoryConstellation() {
  const reduce = useReducedMotion();
  const nodes = categoryBuckets;
  const maxCount = Math.max(...nodes.map((n) => n.count));
  const ringRadius = 168;

  const placed = nodes.map((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
    const x = CENTER + Math.cos(angle) * ringRadius;
    const y = CENTER + Math.sin(angle) * ringRadius;
    const r = 20 + (n.count / maxCount) * 22;
    return { ...n, x, y, r, angle };
  });

  return (
    <div className="constellation" aria-hidden="true">
      <motion.svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="constellation__svg"
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.9, ease, delay: 0.2 }}
      >
        <defs>
          <radialGradient id="hub" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffd277" />
            <stop offset="100%" stopColor="#f2b13c" />
          </radialGradient>
        </defs>

        {/* connecting lines from hub to each node */}
        {placed.map((n, i) => (
          <motion.line
            key={`l-${n.label}`}
            x1={CENTER}
            y1={CENTER}
            x2={n.x}
            y2={n.y}
            stroke="rgba(242,177,60,0.26)"
            strokeWidth={1}
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.7, ease, delay: 0.4 + i * 0.06 }}
          />
        ))}

        {/* reel rings */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={ringRadius}
          fill="none"
          stroke="rgba(246,239,225,0.06)"
          strokeWidth={1}
        />
        <circle
          cx={CENTER}
          cy={CENTER}
          r={ringRadius + 14}
          fill="none"
          stroke="rgba(242,177,60,0.12)"
          strokeWidth={1}
          strokeDasharray="2 8"
        />

        {/* category nodes */}
        {placed.map((n, i) => (
          <motion.g
            key={n.label}
            initial={{ opacity: 0, scale: 0 }}
            animate={
              reduce
                ? { opacity: 1, scale: 1 }
                : {
                    opacity: 1,
                    scale: 1,
                    y: [0, i % 2 === 0 ? -6 : 6, 0],
                  }
            }
            transition={{
              opacity: { duration: 0.5, delay: 0.5 + i * 0.06 },
              scale: { duration: 0.5, ease, delay: 0.5 + i * 0.06 },
              y: {
                duration: 5 + (i % 3),
                repeat: Infinity,
                ease: 'easeInOut',
                delay: i * 0.2,
              },
            }}
          >
            <circle
              cx={n.x}
              cy={n.y}
              r={n.r}
              fill="#1a130b"
              stroke="rgba(242,177,60,0.5)"
              strokeWidth={1.2}
            />
            <text
              x={n.x}
              y={n.y - 2}
              textAnchor="middle"
              className="constellation__count"
            >
              {n.count}
            </text>
            <text
              x={n.x}
              y={n.y + n.r + 14}
              textAnchor="middle"
              className="constellation__label"
            >
              {SHORT[n.label] ?? n.label}
            </text>
          </motion.g>
        ))}

        {/* central hub as a slowly turning film reel */}
        <motion.g
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.6, ease, delay: 0.3 }}
        >
          {/* reel spokes turn behind the gold core */}
          <motion.g
            style={{ originX: `${CENTER}px`, originY: `${CENTER}px` }}
            animate={reduce ? undefined : { rotate: 360 }}
            transition={{ duration: 60, repeat: Infinity, ease: 'linear' }}
          >
            <circle
              cx={CENTER}
              cy={CENTER}
              r={64}
              fill="none"
              stroke="rgba(242,177,60,0.16)"
              strokeWidth={1}
            />
            {Array.from({ length: 6 }).map((_, k) => {
              const a = (k / 6) * Math.PI * 2;
              return (
                <circle
                  key={`hole-${k}`}
                  cx={CENTER + Math.cos(a) * 60}
                  cy={CENTER + Math.sin(a) * 60}
                  r={6}
                  fill="#1a130b"
                  stroke="rgba(242,177,60,0.4)"
                  strokeWidth={1}
                />
              );
            })}
          </motion.g>
          <circle cx={CENTER} cy={CENTER} r={46} fill="url(#hub)" />
          <text
            x={CENTER}
            y={CENTER - 6}
            textAnchor="middle"
            className="constellation__hub-num"
          >
            {totalProjects}
          </text>
          <text
            x={CENTER}
            y={CENTER + 14}
            textAnchor="middle"
            className="constellation__hub-label"
          >
            projects
          </text>
        </motion.g>
      </motion.svg>
    </div>
  );
}
