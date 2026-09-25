// Where a number on this page comes from, in the shape the repository's own
// console uses (launchbridge web/src/sim/provenance.ts). There are two answers
// and every figure the page shows carries one of them:
//
// - MEASURED: read off one real run of the Python service, named by command,
//   target, build and date. The values are the `make demo` block in README.md
//   and the `make ci` line under "CI"; nothing here is rounded or invented.
// - COMPUTED: worked out by this page on a virtual clock with a seeded PRNG.
//
// README.md says of the measured durations: "This machine was running other
// work at the time, so every duration here moves with how busy it is." A
// duration from that run is therefore always shown with its run and that
// caveat, never as a constant.
export const MEASURED = {
  command: 'make demo',
  target: 'compose stack',
  version: '5.0.0',
  commit: 'a924dcd',
  date: '2026-09-15',
  machine: 'macOS 26.0.1, arm64, 10 cpus',
  counts: {
    received: 300,
    accepted: 250,
    deduplicated: 50,
    duplicatesSent: 50,
    delivered: 250,
    deliveredFirstPass: 230,
    deliveredAfterReplay: 20,
    retried: 60,
    failed: 20,
    replayed: 20,
    stillFailed: 0,
    signatureRejections: 3,
    smokeChecks: 15,
    checks: 8,
  },
  latencyMs: { p50: 5184.0, p95: 7328.6 },
  loadCaveat: 'moves with machine load',
} as const;

// One line naming the run the measured numbers come from.
export const MEASURED_LABEL = `measured: ${MEASURED.command} on the ${MEASURED.target}, ${MEASURED.version}, ${MEASURED.commit}, ${MEASURED.date}`;

// The two latencies as the README prints them, one decimal each.
export const MEASURED_LATENCY = `p50 ${MEASURED.latencyMs.p50.toFixed(1)} ms, p95 ${MEASURED.latencyMs.p95.toFixed(1)} ms`;

// One line for anything this page produces while it is driven.
export const COMPUTED_LABEL = 'computed here: virtual clock, seeded PRNG, no network';
