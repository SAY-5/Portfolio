import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './compliance-bootstrap.css';

// Real model from the project: 33 checks across 7 categories, each emitting one
// of four states (pass / fail / skip / unavailable). The four-state model never
// fakes a pass when the surface to measure is absent. The sample macOS run
// reports 3 pass / 11 fail / 0 skip / 19 unavailable. Every failing check maps
// a remediation_id to an idempotent Bash snippet whose content hash is logged
// before it runs, and every check carries a CIS section number as cis_ref.

type State = 'pass' | 'fail' | 'skip' | 'unavailable';

type Check = {
  id: string;
  cis: string;
  label: string;
  cat: string;
  state: State;
  // Failing checks carry an inline remediation snippet and its content hash.
  remediation?: { id: string; hash: string; bash: string };
};

const CATEGORIES = [
  'filesystem',
  'ssh',
  'pam',
  'auditd',
  'network',
  'packages',
  'kernel',
] as const;

// 33 checks modelled on the CIS Ubuntu 22.04 benchmark. States here mirror the
// project's documented sample macOS run: 3 pass, 11 fail, 0 skip, 19 unavailable.
const CHECKS: Check[] = [
  {
    id: 'cramfs-disabled',
    cis: '1.1.1.1',
    label: 'cramfs module disabled',
    cat: 'filesystem',
    state: 'unavailable',
  },
  {
    id: 'tmp-separate',
    cis: '1.1.2',
    label: '/tmp on a separate partition',
    cat: 'filesystem',
    state: 'fail',
    remediation: {
      id: 'tmp-mount-unit',
      hash: 'b3a91f',
      bash: `systemctl unmask tmp.mount
systemctl enable --now tmp.mount`,
    },
  },
  {
    id: 'tmp-nodev',
    cis: '1.1.2.2',
    label: 'nodev option set on /tmp',
    cat: 'filesystem',
    state: 'unavailable',
  },
  {
    id: 'shm-noexec',
    cis: '1.1.3.3',
    label: 'noexec option set on /dev/shm',
    cat: 'filesystem',
    state: 'fail',
    remediation: {
      id: 'shm-noexec-fstab',
      hash: '7c20de',
      bash: `grep -q '/dev/shm' /etc/fstab || \\
  echo 'tmpfs /dev/shm tmpfs defaults,noexec,nodev,nosuid 0 0' >> /etc/fstab
mount -o remount,noexec,nodev,nosuid /dev/shm`,
    },
  },
  {
    id: 'sticky-world-dirs',
    cis: '1.1.22',
    label: 'sticky bit on world-writable dirs',
    cat: 'filesystem',
    state: 'pass',
  },
  {
    id: 'ssh-permit-root',
    cis: '5.2.8',
    label: 'SSH PermitRootLogin disabled',
    cat: 'ssh',
    state: 'fail',
    remediation: {
      id: 'sshd-permit-root-no',
      hash: 'a14f8c',
      bash: `f=/etc/ssh/sshd_config
if grep -qE '^[#[:space:]]*PermitRootLogin' "$f"; then
  sed -ri 's/^[#[:space:]]*PermitRootLogin.*/PermitRootLogin no/' "$f"
else
  echo 'PermitRootLogin no' >> "$f"
fi
sshd -t && systemctl reload ssh`,
    },
  },
  {
    id: 'ssh-maxauth',
    cis: '5.2.7',
    label: 'SSH MaxAuthTries set to 4',
    cat: 'ssh',
    state: 'fail',
    remediation: {
      id: 'sshd-maxauth-4',
      hash: 'd9b701',
      bash: `f=/etc/ssh/sshd_config
if grep -qE '^[#[:space:]]*MaxAuthTries' "$f"; then
  sed -ri 's/^[#[:space:]]*MaxAuthTries.*/MaxAuthTries 4/' "$f"
else
  echo 'MaxAuthTries 4' >> "$f"
fi
sshd -t && systemctl reload ssh`,
    },
  },
  {
    id: 'ssh-x11',
    cis: '5.2.10',
    label: 'SSH X11Forwarding disabled',
    cat: 'ssh',
    state: 'unavailable',
  },
  {
    id: 'ssh-clientalive',
    cis: '5.2.16',
    label: 'SSH idle timeout configured',
    cat: 'ssh',
    state: 'unavailable',
  },
  {
    id: 'ssh-loglevel',
    cis: '5.2.5',
    label: 'SSH LogLevel set to VERBOSE',
    cat: 'ssh',
    state: 'unavailable',
  },
  {
    id: 'pam-pwquality',
    cis: '5.3.1',
    label: 'password length minimum enforced',
    cat: 'pam',
    state: 'fail',
    remediation: {
      id: 'pwquality-minlen-14',
      hash: '2f8a55',
      bash: `f=/etc/security/pwquality.conf
if grep -qE '^[#[:space:]]*minlen' "$f"; then
  sed -ri 's/^[#[:space:]]*minlen.*/minlen = 14/' "$f"
else
  echo 'minlen = 14' >> "$f"
fi`,
    },
  },
  {
    id: 'pam-lockout',
    cis: '5.3.2',
    label: 'lockout for failed attempts',
    cat: 'pam',
    state: 'unavailable',
  },
  {
    id: 'pam-reuse',
    cis: '5.3.3',
    label: 'password reuse limited',
    cat: 'pam',
    state: 'unavailable',
  },
  {
    id: 'pam-history',
    cis: '5.4.1.1',
    label: 'password expiration 365 or less',
    cat: 'pam',
    state: 'fail',
    remediation: {
      id: 'login-defs-maxdays',
      hash: 'e6c4a0',
      bash: `f=/etc/login.defs
sed -ri 's/^[#[:space:]]*PASS_MAX_DAYS.*/PASS_MAX_DAYS 365/' "$f" \\
  || echo 'PASS_MAX_DAYS 365' >> "$f"`,
    },
  },
  {
    id: 'auditd-enabled',
    cis: '4.1.1.1',
    label: 'auditd is installed',
    cat: 'auditd',
    state: 'unavailable',
  },
  {
    id: 'auditd-running',
    cis: '4.1.1.2',
    label: 'auditd service enabled',
    cat: 'auditd',
    state: 'unavailable',
  },
  {
    id: 'auditd-time',
    cis: '4.1.3',
    label: 'time change events captured',
    cat: 'auditd',
    state: 'unavailable',
  },
  {
    id: 'auditd-identity',
    cis: '4.1.4',
    label: 'identity changes captured',
    cat: 'auditd',
    state: 'unavailable',
  },
  {
    id: 'auditd-logins',
    cis: '4.1.5',
    label: 'login events captured',
    cat: 'auditd',
    state: 'unavailable',
  },
  {
    id: 'auditd-immutable',
    cis: '4.1.17',
    label: 'audit config is immutable',
    cat: 'auditd',
    state: 'unavailable',
  },
  {
    id: 'net-ip-forward',
    cis: '3.1.1',
    label: 'IP forwarding disabled',
    cat: 'network',
    state: 'fail',
    remediation: {
      id: 'sysctl-ip-forward-0',
      hash: 'c0ffee',
      bash: `echo 'net.ipv4.ip_forward = 0' > /etc/sysctl.d/60-ip-forward.conf
sysctl -w net.ipv4.ip_forward=0
sysctl --system`,
    },
  },
  {
    id: 'net-redirects',
    cis: '3.2.2',
    label: 'ICMP redirects not accepted',
    cat: 'network',
    state: 'fail',
    remediation: {
      id: 'sysctl-accept-redirects-0',
      hash: '5b1a3d',
      bash: `cat > /etc/sysctl.d/60-redirects.conf <<'EOF'
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
EOF
sysctl --system`,
    },
  },
  {
    id: 'net-source-route',
    cis: '3.2.1',
    label: 'source routed packets rejected',
    cat: 'network',
    state: 'unavailable',
  },
  {
    id: 'net-syncookies',
    cis: '3.2.8',
    label: 'TCP SYN cookies enabled',
    cat: 'network',
    state: 'pass',
  },
  {
    id: 'net-firewall',
    cis: '3.4.1.1',
    label: 'a host firewall is active',
    cat: 'network',
    state: 'fail',
    remediation: {
      id: 'ufw-enable',
      hash: '9ad7f2',
      bash: `ufw allow OpenSSH
ufw --force enable`,
    },
  },
  {
    id: 'pkg-updates',
    cis: '1.9',
    label: 'package updates installed',
    cat: 'packages',
    state: 'unavailable',
  },
  {
    id: 'pkg-gpg-keys',
    cis: '1.2.1',
    label: 'package manager GPG keys set',
    cat: 'packages',
    state: 'unavailable',
  },
  {
    id: 'pkg-aide',
    cis: '1.3.1',
    label: 'file integrity tool installed',
    cat: 'packages',
    state: 'fail',
    remediation: {
      id: 'install-aide',
      hash: '4e2b9a',
      bash: `DEBIAN_FRONTEND=noninteractive apt-get install -y aide aide-common
aideinit -y -f`,
    },
  },
  {
    id: 'pkg-prelink',
    cis: '1.5.4',
    label: 'prelink not installed',
    cat: 'packages',
    state: 'pass',
  },
  {
    id: 'kernel-aslr',
    cis: '1.5.1',
    label: 'address space randomization on',
    cat: 'kernel',
    state: 'fail',
    remediation: {
      id: 'sysctl-aslr-2',
      hash: 'aa30c1',
      bash: `echo 'kernel.randomize_va_space = 2' > /etc/sysctl.d/60-aslr.conf
sysctl -w kernel.randomize_va_space=2`,
    },
  },
  {
    id: 'kernel-ptrace',
    cis: '1.5.2',
    label: 'ptrace scope restricted',
    cat: 'kernel',
    state: 'unavailable',
  },
  {
    id: 'kernel-core-dumps',
    cis: '1.5.3',
    label: 'core dumps restricted',
    cat: 'kernel',
    state: 'unavailable',
  },
  {
    id: 'kernel-apparmor',
    cis: '1.6.1.1',
    label: 'mandatory access control active',
    cat: 'kernel',
    state: 'unavailable',
  },
];

const STATE_LABEL: Record<State, string> = {
  pass: 'pass',
  fail: 'fail',
  skip: 'skip',
  unavailable: 'unavailable',
};

const ORDER: State[] = ['pass', 'fail', 'skip', 'unavailable'];
const ease = [0.22, 1, 0.36, 1] as const;

export default function ComplianceBootstrapDemo() {
  const reduce = useReducedMotion();
  const [revealed, setRevealed] = useState<number>(0); // how many cells scanned
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<State | 'all'>('all');
  const timer = useRef<number | null>(null);

  const done = revealed >= CHECKS.length;

  function stop() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }
  useEffect(() => stop, []);

  function run() {
    stop();
    setOpen(null);
    setRunning(true);
    setRevealed(0);
    if (reduce) {
      setRevealed(CHECKS.length);
      setRunning(false);
      return;
    }
    let i = 0;
    const step = () => {
      i += 1;
      setRevealed(i);
      if (i >= CHECKS.length) {
        setRunning(false);
        timer.current = null;
        return;
      }
      timer.current = window.setTimeout(step, 60);
    };
    timer.current = window.setTimeout(step, 60);
  }

  function reset() {
    stop();
    setRunning(false);
    setRevealed(0);
    setOpen(null);
    setFilter('all');
  }

  // Counts only reflect cells that have been scanned so far.
  const counts: Record<State, number> = { pass: 0, fail: 0, skip: 0, unavailable: 0 };
  CHECKS.slice(0, revealed).forEach((c) => {
    counts[c.state] += 1;
  });

  const openCheck = open ? CHECKS.find((c) => c.id === open) : null;

  return (
    <div className="demo" aria-label="compliance-bootstrap audit grid demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">33 checks, four honest states</h3>
      <p className="demo__lede">
        Run the audit to walk a host through 33 CIS-flavored checks across seven
        categories. Each cell settles on pass, fail, skip, or unavailable, and the
        runner never fakes a pass when the surface to measure is absent. Open a
        failing cell for its inline Bash remediation and the content hash logged
        before it runs.
      </p>

      <div className="cb__counts" role="group" aria-label="result tally">
        {ORDER.map((s) => {
          const isFilter = filter === s;
          return (
            <button
              key={s}
              type="button"
              className={`cb__count cb__count--${s} ${isFilter ? 'cb__count--on' : ''}`}
              aria-pressed={isFilter}
              onClick={() => setFilter((f) => (f === s ? 'all' : s))}
            >
              <span className="cb__count-dot" aria-hidden="true" />
              <span className="cb__count-val">{counts[s]}</span>
              <span className="cb__count-name">{STATE_LABEL[s]}</span>
            </button>
          );
        })}
      </div>

      <div className="cb__grid-wrap">
        {CATEGORIES.map((cat) => {
          const items = CHECKS.filter((c) => c.cat === cat);
          return (
            <div className="cb__cat" key={cat}>
              <div className="cb__cat-name">{cat}</div>
              <ul className="cb__row">
                {items.map((c) => {
                  const idx = CHECKS.indexOf(c);
                  const scanned = idx < revealed;
                  const dimmed = filter !== 'all' && c.state !== filter;
                  const failable = c.state === 'fail' && Boolean(c.remediation);
                  return (
                    <li key={c.id}>
                      <motion.button
                        type="button"
                        className={`cb__cell ${scanned ? `cb__cell--${c.state}` : 'cb__cell--idle'} ${
                          dimmed && scanned ? 'cb__cell--dim' : ''
                        } ${open === c.id ? 'cb__cell--open' : ''}`}
                        title={`${c.cis}  ${c.label}`}
                        aria-label={`${c.cis} ${c.label}: ${
                          scanned ? STATE_LABEL[c.state] : 'not yet scanned'
                        }${failable ? ', has remediation' : ''}`}
                        disabled={!scanned || !failable}
                        aria-expanded={failable ? open === c.id : undefined}
                        onClick={() => {
                          if (failable) setOpen((o) => (o === c.id ? null : c.id));
                        }}
                        initial={false}
                        animate={
                          scanned
                            ? { scale: reduce ? 1 : [0.6, 1.08, 1], opacity: 1 }
                            : { scale: 1, opacity: 1 }
                        }
                        transition={{ duration: reduce ? 0 : 0.32, ease }}
                      >
                        <span className="cb__cell-cis">{c.cis}</span>
                        {failable && scanned && (
                          <span className="cb__cell-fix" aria-hidden="true">
                            fix
                          </span>
                        )}
                      </motion.button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      <AnimatePresence initial={false}>
        {openCheck && openCheck.remediation && (
          <motion.div
            className="cb__remed"
            key={openCheck.id}
            initial={{ opacity: 0, height: reduce ? 'auto' : 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: reduce ? 'auto' : 0 }}
            transition={{ duration: reduce ? 0 : 0.3, ease }}
          >
            <div className="cb__remed-head">
              <span className="cb__remed-cis">{openCheck.cis}</span>
              <span className="cb__remed-label">{openCheck.label}</span>
              <span className="cb__remed-state">fail</span>
            </div>
            <div className="cb__remed-meta">
              <span>
                remediation_id <b>{openCheck.remediation.id}</b>
              </span>
              <span>
                content hash <b>sha256:{openCheck.remediation.hash}</b>
              </span>
            </div>
            <pre className="cb__remed-bash" aria-label="remediation bash snippet">
              <code>{openCheck.remediation.bash}</code>
            </pre>
            <p className="cb__remed-note">
              The hash is logged before the snippet runs, so the report proves
              which exact Bash executed on the host.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running}>
          {running ? 'Auditing…' : done ? 'Re-run audit' : 'Run audit'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">
          {done
            ? `${counts.pass} pass / ${counts.fail} fail / ${counts.skip} skip / ${counts.unavailable} unavailable`
            : running
              ? `scanning ${revealed} of ${CHECKS.length}`
              : '33 checks, 7 categories, 130 unit tests with no real I/O'}
        </span>
      </div>
    </div>
  );
}
