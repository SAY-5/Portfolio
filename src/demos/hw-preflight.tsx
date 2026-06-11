import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './hw-preflight.css';

// hw-preflight runs checks across CPU, memory, disk, kernel, thermal, serial,
// network, GPIO, I2C, systemd, NVMe SMART, USB, RTC drift, IOMMU, VM
// overcommit, and SELinux, each emitting one of four states.
// The ci-runner profile reproduces the committed sample run on an
// ubuntu-24.04 GitHub Actions runner: 11 pass, 1 fail, 2 skip, 4 unavailable
// across 18 checks.
type State = 'pass' | 'fail' | 'skip' | 'unavailable';
type Profile = 'ci-runner' | 'production-server' | 'edge-device';

type Check = {
  id: string;
  category: string;
  measured: string;
  // per-profile threshold + verdict
  by: Record<Profile, { state: State; thresh: string; note: string }>;
};

const PROFILES: { id: Profile; label: string }[] = [
  { id: 'ci-runner', label: 'ci-runner' },
  { id: 'production-server', label: 'production-server' },
  { id: 'edge-device', label: 'edge-device' },
];

// 18 checks, matching the committed ci-runner sample distribution.
const CHECKS: Check[] = [
  {
    id: 'cpu_cores', category: 'CPU', measured: '4 cores',
    by: {
      'ci-runner': { state: 'pass', thresh: '>= 2', note: 'enough cores for the runner' },
      'production-server': { state: 'fail', thresh: '>= 16', note: 'below the server minimum' },
      'edge-device': { state: 'pass', thresh: '>= 2', note: 'edge profile tolerant' },
    },
  },
  {
    id: 'cpuid_flags', category: 'CPU', measured: 'sse4_2 avx2',
    by: {
      'ci-runner': { state: 'pass', thresh: 'avx2', note: 'read via pybind11 CPUID helper' },
      'production-server': { state: 'pass', thresh: 'avx2', note: 'read via pybind11 CPUID helper' },
      'edge-device': { state: 'fail', thresh: 'avx512', note: 'edge target needs avx512' },
    },
  },
  {
    id: 'mem_total', category: 'Memory', measured: '15.6 GiB',
    by: {
      'ci-runner': { state: 'pass', thresh: '>= 4 GiB', note: 'comfortable headroom' },
      'production-server': { state: 'fail', thresh: '>= 64 GiB', note: 'short of server target' },
      'edge-device': { state: 'pass', thresh: '>= 2 GiB', note: 'edge minimum met' },
    },
  },
  {
    id: 'vm_overcommit', category: 'Memory', measured: 'mode 0',
    by: {
      'ci-runner': { state: 'pass', thresh: 'mode 0 or 1', note: 'heuristic overcommit ok' },
      'production-server': { state: 'fail', thresh: 'mode 2', note: 'server wants strict overcommit' },
      'edge-device': { state: 'pass', thresh: 'mode 0 or 1', note: 'heuristic overcommit ok' },
    },
  },
  {
    id: 'disk_free', category: 'Disk', measured: '64.2 GiB free',
    by: {
      'ci-runner': { state: 'pass', thresh: '>= 8 GiB', note: 'plenty of scratch space' },
      'production-server': { state: 'pass', thresh: '>= 32 GiB', note: 'within budget' },
      'edge-device': { state: 'fail', thresh: '>= 128 GiB', note: 'edge expects larger volume' },
    },
  },
  {
    id: 'nvme_smart', category: 'NVMe SMART', measured: 'health unknown',
    by: {
      'ci-runner': { state: 'unavailable', thresh: 'PASSED', note: 'no NVMe device on runner' },
      'production-server': { state: 'pass', thresh: 'PASSED', note: 'SMART overall PASSED' },
      'edge-device': { state: 'unavailable', thresh: 'PASSED', note: 'eMMC has no SMART surface' },
    },
  },
  {
    id: 'kernel_version', category: 'Kernel', measured: '6.8.0-1010',
    by: {
      'ci-runner': { state: 'pass', thresh: '>= 5.15', note: 'modern kernel' },
      'production-server': { state: 'pass', thresh: '>= 5.15', note: 'modern kernel' },
      'edge-device': { state: 'pass', thresh: '>= 5.10', note: 'edge LTS line ok' },
    },
  },
  {
    id: 'iommu', category: 'IOMMU', measured: 'not enabled',
    by: {
      'ci-runner': { state: 'skip', thresh: 'enabled', note: 'skipped, not required on runner' },
      'production-server': { state: 'fail', thresh: 'enabled', note: 'server needs IOMMU for passthrough' },
      'edge-device': { state: 'skip', thresh: 'enabled', note: 'skipped on edge profile' },
    },
  },
  {
    id: 'selinux', category: 'SELinux', measured: 'disabled',
    by: {
      'ci-runner': { state: 'pass', thresh: 'any', note: 'no SELinux requirement here' },
      'production-server': { state: 'fail', thresh: 'enforcing', note: 'server requires enforcing' },
      'edge-device': { state: 'pass', thresh: 'any', note: 'edge does not require it' },
    },
  },
  {
    id: 'thermal', category: 'Thermal', measured: 'no sysfs zone',
    by: {
      'ci-runner': { state: 'unavailable', thresh: '< 80 C', note: '/sys/class/thermal absent' },
      'production-server': { state: 'pass', thresh: '< 80 C', note: '41 C, well under limit' },
      'edge-device': { state: 'pass', thresh: '< 70 C', note: '52 C, under edge limit' },
    },
  },
  {
    id: 'rtc_drift', category: 'RTC drift', measured: 'no /dev/rtc',
    by: {
      'ci-runner': { state: 'unavailable', thresh: '< 2 s', note: 'no RTC device on runner' },
      'production-server': { state: 'pass', thresh: '< 2 s', note: '0.3 s drift' },
      'edge-device': { state: 'fail', thresh: '< 0.5 s', note: '1.1 s drift, over edge limit' },
    },
  },
  {
    id: 'serial', category: 'Serial', measured: 'loopback ok',
    by: {
      'ci-runner': { state: 'pass', thresh: 'round-trip', note: 'socat pty handshake echoed' },
      'production-server': { state: 'skip', thresh: 'round-trip', note: 'no console port wired' },
      'edge-device': { state: 'pass', thresh: 'round-trip', note: 'UART round-trip ok' },
    },
  },
  {
    id: 'network', category: 'Network', measured: 'eth0 up',
    by: {
      'ci-runner': { state: 'pass', thresh: 'link up', note: 'carrier detected' },
      'production-server': { state: 'pass', thresh: 'link up, 10G', note: 'bonded link up' },
      'edge-device': { state: 'pass', thresh: 'link up', note: 'carrier detected' },
    },
  },
  {
    id: 'gpio', category: 'GPIO', measured: 'no chip',
    by: {
      'ci-runner': { state: 'skip', thresh: 'gpiochip0', note: 'no GPIO on a cloud runner' },
      'production-server': { state: 'skip', thresh: 'gpiochip0', note: 'no GPIO on server' },
      'edge-device': { state: 'pass', thresh: 'gpiochip0', note: 'gpiochip0 present, 28 lines' },
    },
  },
  {
    id: 'i2c', category: 'I2C', measured: 'no bus',
    by: {
      'ci-runner': { state: 'unavailable', thresh: 'i2c-1', note: 'no i2c adapter present' },
      'production-server': { state: 'unavailable', thresh: 'i2c-1', note: 'no i2c adapter present' },
      'edge-device': { state: 'pass', thresh: 'i2c-1', note: 'i2c-1 detected at 0x48' },
    },
  },
  {
    id: 'usb', category: 'USB', measured: '3 devices',
    by: {
      'ci-runner': { state: 'pass', thresh: 'enumerable', note: 'lsusb enumerated cleanly' },
      'production-server': { state: 'pass', thresh: 'enumerable', note: 'lsusb enumerated cleanly' },
      'edge-device': { state: 'pass', thresh: 'enumerable', note: 'lsusb enumerated cleanly' },
    },
  },
  {
    id: 'systemd', category: 'systemd', measured: 'degraded',
    by: {
      'ci-runner': { state: 'fail', thresh: 'running', note: 'systemctl reports degraded state' },
      'production-server': { state: 'fail', thresh: 'running', note: 'one unit failed' },
      'edge-device': { state: 'pass', thresh: 'running', note: 'all units active' },
    },
  },
  {
    id: 'mem_pressure', category: 'Memory', measured: 'PSI 0.4%',
    by: {
      'ci-runner': { state: 'pass', thresh: '< 5%', note: 'pressure well under limit' },
      'production-server': { state: 'pass', thresh: '< 5%', note: 'pressure well under limit' },
      'edge-device': { state: 'pass', thresh: '< 10%', note: 'pressure under edge limit' },
    },
  },
];

const STATE_LABEL: Record<State, string> = {
  pass: 'pass',
  fail: 'fail',
  skip: 'skip',
  unavailable: 'unavail',
};

const ease = [0.22, 1, 0.36, 1] as const;

export default function HwPreflightDemo() {
  const reduce = useReducedMotion();
  const [profile, setProfile] = useState<Profile>('ci-runner');
  const [openId, setOpenId] = useState<string | null>(null);

  const resolved = useMemo(
    () =>
      CHECKS.map((c) => ({
        id: c.id,
        category: c.category,
        measured: c.measured,
        ...c.by[profile],
      })),
    [profile],
  );

  const tally = useMemo(() => {
    const t: Record<State, number> = { pass: 0, fail: 0, skip: 0, unavailable: 0 };
    for (const r of resolved) t[r.state] += 1;
    return t;
  }, [resolved]);

  const exitOnFail = tally.fail > 0;
  const open = resolved.find((r) => r.id === openId) ?? null;

  return (
    <div className="demo" aria-label="hw-preflight check dashboard demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Pre-flight, four honest states</h3>
      <p className="demo__lede">
        Run the check suite under a profile. Each tile reports pass, fail, skip,
        or unavailable with its measured value and threshold. Switch profiles to
        watch thresholds shift, and note that skip and unavailable stay distinct
        so a missing sensor is reported honestly rather than fake-passed. Only a
        fail trips exit-on-fail.
      </p>

      <div className="hp__stage">
        <div className="hp__profiles" role="tablist" aria-label="profile">
          {PROFILES.map((p) => (
            <button
              key={p.id}
              role="tab"
              aria-selected={profile === p.id}
              className={`hp__profile${profile === p.id ? ' hp__profile--on' : ''}`}
              onClick={() => {
                setProfile(p.id);
                setOpenId(null);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="hp__tally">
          {(['pass', 'fail', 'skip', 'unavailable'] as State[]).map((s) => (
            <div key={s} className={`hp__tally-cell hp__tally--${s}`}>
              <motion.span
                key={`${profile}-${s}-${tally[s]}`}
                className="hp__tally-val"
                initial={{ opacity: reduce ? 1 : 0, y: reduce ? 0 : 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduce ? 0 : 0.25, ease }}
              >
                {tally[s]}
              </motion.span>
              <span className="hp__tally-label">{s}</span>
            </div>
          ))}
        </div>

        <div className="hp__grid" role="list" aria-label="hardware checks">
          {resolved.map((r, i) => (
            <motion.button
              key={r.id}
              role="listitem"
              className={`hp__tile hp__tile--${r.state}`}
              aria-pressed={openId === r.id}
              aria-label={`${r.id} ${r.state}`}
              onClick={() => setOpenId(openId === r.id ? null : r.id)}
              initial={{ opacity: reduce ? 1 : 0, y: reduce ? 0 : 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: reduce ? 0 : 0.25,
                delay: reduce ? 0 : Math.min(i * 0.02, 0.3),
                ease,
              }}
            >
              <div className="hp__tile-top">
                <span className="hp__tile-name">{r.id}</span>
                <span className="hp__tile-state">{STATE_LABEL[r.state]}</span>
              </div>
              <div className="hp__tile-measure">
                <span>{r.measured}</span>
                <span className="hp__tile-thresh">{r.thresh}</span>
              </div>
              <div className="hp__tile-note">{r.note}</div>
            </motion.button>
          ))}
        </div>

        {open && (
          <motion.div
            className="hp__detail"
            key={open.id}
            initial={{ opacity: reduce ? 1 : 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduce ? 0 : 0.3, ease }}
          >
            <div className="hp__detail-head">
              <span className="hp__detail-name">{open.id}</span>
              <span className="hp__detail-state">
                {open.category} / {open.state}
              </span>
            </div>
            <div className="hp__detail-grid">
              <div className="hp__detail-row">
                <span className="hp__detail-label">measured</span>
                <span className="hp__detail-val">{open.measured}</span>
              </div>
              <div className="hp__detail-row">
                <span className="hp__detail-label">expected</span>
                <span className="hp__detail-val">{open.thresh}</span>
              </div>
              <div className="hp__detail-row" style={{ gridColumn: '1 / -1' }}>
                <span className="hp__detail-label">reason</span>
                <span className="hp__detail-val">{open.note}</span>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      <div className="demo__controls">
        <span className="demo__hint">
          {resolved.length} checks, exit-on-fail{' '}
          {exitOnFail ? 'tripped by ' + tally.fail + ' fail' : 'clear'}
          {profile === 'ci-runner'
            ? ', matches the committed ubuntu-24.04 sample run'
            : ''}
        </span>
      </div>
    </div>
  );
}
