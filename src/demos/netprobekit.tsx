import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './netprobekit.css';

// Real facts from the project: a ~400-line C target daemon compiled with
// cc -O2 speaks line-delimited JSON over a TCP control channel. Python probes
// issue the same RPCs real hardware probes would: ping, throughput, CRC
// integrity, CAN frame read and transmit, sensor reads with history, and
// firmware version checks. The first action of every session is
// firmware.version(), so a version mismatch fails one test with a single
// actionable line. 17 tests run green across Ethernet, CAN, sensor, and
// firmware suites, and every round-trip is consolidated into one report.json.
const DAEMON_LINES = 400;
const TEST_COUNT = 17;

const ease = [0.22, 1, 0.36, 1] as const;

type Probe = {
  id: string;
  suite: 'firmware' | 'ethernet' | 'can' | 'sensor';
  rpc: string;
  // The line-delimited JSON request and the daemon's response.
  req: string;
  res: string;
  detail: string;
};

// The replayed session, in the order the runner issues it. firmware.version()
// is always first so a mismatch fails fast.
const SESSION: Probe[] = [
  {
    id: 'p0',
    suite: 'firmware',
    rpc: 'firmware.version',
    req: '{"rpc":"firmware.version"}',
    res: '{"ok":true,"version":"1.4.2","crc":"a91f"}',
    detail: 'version 1.4.2 matches expected, crc a91f',
  },
  {
    id: 'p1',
    suite: 'ethernet',
    rpc: 'net.ping',
    req: '{"rpc":"net.ping","count":4}',
    res: '{"ok":true,"rtt_ms":[0.21,0.19,0.22,0.20]}',
    detail: '4 of 4 replies, mean rtt 0.20 ms',
  },
  {
    id: 'p2',
    suite: 'ethernet',
    rpc: 'net.throughput',
    req: '{"rpc":"net.throughput","bytes":1048576}',
    res: '{"ok":true,"mbps":942.6}',
    detail: '1 MiB transfer at 942.6 Mbps',
  },
  {
    id: 'p3',
    suite: 'ethernet',
    rpc: 'net.crc',
    req: '{"rpc":"net.crc","frames":256}',
    res: '{"ok":true,"crc_errors":0}',
    detail: '256 frames, 0 crc errors',
  },
  {
    id: 'p4',
    suite: 'can',
    rpc: 'can.read',
    req: '{"rpc":"can.read","id":"0x1A0"}',
    res: '{"ok":true,"id":"0x1A0","data":"DE AD BE EF"}',
    detail: 'frame 0x1A0 read, 4 bytes',
  },
  {
    id: 'p5',
    suite: 'can',
    rpc: 'can.transmit',
    req: '{"rpc":"can.transmit","id":"0x200","data":"01 02"}',
    res: '{"ok":true,"acked":true}',
    detail: 'frame 0x200 transmitted, acked',
  },
  {
    id: 'p6',
    suite: 'sensor',
    rpc: 'sensor.read',
    req: '{"rpc":"sensor.read","ch":"temp"}',
    res: '{"ok":true,"value":41.8,"unit":"C"}',
    detail: 'temp 41.8 C, within range',
  },
  {
    id: 'p7',
    suite: 'sensor',
    rpc: 'sensor.history',
    req: '{"rpc":"sensor.history","ch":"temp","n":8}',
    res: '{"ok":true,"n":8,"trend":"stable"}',
    detail: '8-sample history, trend stable',
  },
];

// A small sensor history (deterministic) for the gauge sparkline.
const SENSOR_HISTORY = [39.1, 40.4, 41.0, 40.6, 41.2, 41.9, 41.5, 41.8];

const SUITE_LABEL: Record<Probe['suite'], string> = {
  firmware: 'firmware',
  ethernet: 'ethernet',
  can: 'can',
  sensor: 'sensor',
};

function sparkPath(vals: number[], w: number, h: number) {
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  return vals
    .map((v, i) => {
      const x = (i / (vals.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 6) - 3;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

export default function NetProbeKitDemo() {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0); // index of next probe to run (0..len)
  const [running, setRunning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function advance() {
    setStep((prev) => {
      const next = prev + 1;
      if (next >= SESSION.length) {
        setRunning(false);
        return next;
      }
      if (!reduce) {
        timerRef.current = setTimeout(advance, 900);
      }
      return next;
    });
  }

  function play() {
    if (running) return;
    if (step >= SESSION.length) {
      setStep(0);
    }
    setRunning(true);
    if (reduce) {
      setStep(SESSION.length);
      setRunning(false);
      return;
    }
    timerRef.current = setTimeout(advance, 500);
  }

  function pause() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setRunning(false);
  }

  function reset() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setRunning(false);
    setStep(0);
  }

  function stepOnce() {
    if (running) return;
    if (step >= SESSION.length) return;
    advance();
  }

  const done = step >= SESSION.length;
  const active = step > 0 ? SESSION[Math.min(step, SESSION.length) - 1] : null;
  const passed = Math.min(step, SESSION.length);
  // Sensor gauge fill reflects the last temp read once that probe has fired.
  const sensorRun = step > 6;
  const lastTemp = SENSOR_HISTORY[SENSOR_HISTORY.length - 1];

  return (
    <div className="demo" aria-label="netprobekit demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Replay the probe session over the JSON channel</h3>
      <p className="demo__lede">
        Each probe issues one line-delimited JSON RPC to the C target daemon and
        the panel lights up as responses come back. The session opens with
        firmware.version() so a mismatch fails fast, then walks the Ethernet,
        CAN, and sensor suites into one report.
      </p>

      <div className="np__stage">
        <div className="np__channel" aria-hidden="true">
          <span className="np__channel-end np__channel-end--host">probe</span>
          <div className="np__wire">
            <AnimatePresence>
              {running && !reduce && (
                <motion.span
                  key={step}
                  className="np__packet"
                  initial={{ left: '0%', opacity: 0 }}
                  animate={{ left: '100%', opacity: [0, 1, 1, 0] }}
                  transition={{ duration: 0.8, ease }}
                />
              )}
            </AnimatePresence>
          </div>
          <span className="np__channel-end np__channel-end--target">daemon</span>
        </div>

        <div className="np__grid">
          <div className="np__suites">
            {(['firmware', 'ethernet', 'can', 'sensor'] as const).map((suite) => {
              const probes = SESSION.filter((p) => p.suite === suite);
              const doneCount = probes.filter((p) => SESSION.indexOf(p) < step).length;
              const allDone = doneCount === probes.length;
              const anyRunning = active?.suite === suite && running;
              return (
                <div
                  key={suite}
                  className={`np__suite ${allDone ? 'np__suite--ok' : ''} ${anyRunning ? 'np__suite--active' : ''}`}
                >
                  <span className="np__suite-dot" />
                  <span className="np__suite-name">{SUITE_LABEL[suite]}</span>
                  <span className="np__suite-count">
                    {doneCount}/{probes.length}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="np__gauges">
            <div className={`np__gauge ${sensorRun ? 'np__gauge--on' : ''}`}>
              <div className="np__gauge-head">
                <span>sensor: temp</span>
                <b>{sensorRun ? `${lastTemp.toFixed(1)} C` : '— C'}</b>
              </div>
              <svg className="np__spark" viewBox="0 0 160 38" role="img" aria-label="sensor temperature history">
                <motion.path
                  d={sparkPath(SENSOR_HISTORY, 160, 38)}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  initial={{ pathLength: reduce ? 1 : 0 }}
                  animate={{ pathLength: sensorRun ? 1 : 0 }}
                  transition={{ duration: reduce ? 0 : 0.7, ease }}
                />
              </svg>
            </div>

            <div className={`np__gauge ${step > 4 ? 'np__gauge--on' : ''}`}>
              <div className="np__gauge-head">
                <span>can frames</span>
                <b>{step > 5 ? '2 tx/rx' : step > 4 ? '1 rx' : 'idle'}</b>
              </div>
              <div className="np__can">
                {['0x1A0', '0x200'].map((id, i) => {
                  const lit = step > 4 + i;
                  return (
                    <span key={id} className={`np__can-frame ${lit ? 'np__can-frame--on' : ''}`}>
                      {id}
                    </span>
                  );
                })}
              </div>
            </div>

            <div className={`np__gauge ${step > 0 ? 'np__gauge--on' : ''}`}>
              <div className="np__gauge-head">
                <span>firmware crc</span>
                <b>{step > 0 ? 'a91f' : '----'}</b>
              </div>
              <div className="np__crc">
                <span className={`np__crc-state ${step > 0 ? 'np__crc-state--ok' : ''}`}>
                  {step > 0 ? 'v1.4.2 match' : 'awaiting'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="np__log">
          <div className="np__log-head">
            <span>line-delimited JSON</span>
            <span className="np__log-count">
              {passed}/{SESSION.length} round-trips
            </span>
          </div>
          <AnimatePresence mode="popLayout">
            {active ? (
              <motion.div
                key={active.id}
                className="np__log-body"
                initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.25, ease }}
              >
                <code className="np__log-line np__log-line--out">{'>'} {active.req}</code>
                <code className="np__log-line np__log-line--in">{'<'} {active.res}</code>
                <span className="np__log-detail">
                  {active.suite}: {active.detail}
                </span>
              </motion.div>
            ) : (
              <div className="np__log-body np__log-body--empty">
                press play to replay the session
              </div>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {done && (
            <motion.div
              className="np__report"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease }}
            >
              <span className="np__report-head">report.json written</span>
              <span className="np__report-text">
                All {SESSION.length} probes consolidated into one report. The
                full suite runs {TEST_COUNT} tests green against a ~
                {DAEMON_LINES}-line C daemon compiled with cc -O2.
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={running ? pause : play}>
          {running ? 'Pause' : done ? 'Replay' : 'Play session'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={stepOnce}
          disabled={running || done}
        >
          Step
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={step === 0 && !running}
        >
          Reset
        </button>
        <span className="demo__hint">
          {SESSION.length} probes, 4 suites
        </span>
      </div>
    </div>
  );
}
