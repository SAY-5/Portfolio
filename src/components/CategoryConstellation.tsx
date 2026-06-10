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
            <stop offset="0%" stopColor="#ff7d52" />
            <stop offset="100%" stopColor="#ff5b29" />
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
            stroke="rgba(255,91,41,0.28)"
            strokeWidth={1}
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.7, ease, delay: 0.4 + i * 0.06 }}
          />
        ))}

        {/* orbit ring */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={ringRadius}
          fill="none"
          stroke="rgba(244,242,236,0.06)"
          strokeWidth={1}
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
              fill="#15151b"
              stroke="rgba(255,91,41,0.5)"
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

        {/* central hub */}
        <motion.g
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.6, ease, delay: 0.3 }}
        >
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
