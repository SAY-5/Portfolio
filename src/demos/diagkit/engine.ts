// Pure incident generator and root-cause ranker, modelled on the real diagkit
// pipeline: a Go collector simulates a four-service topology from a seeded
// PRNG and normalizes log messages into templates, then a Python analyzer
// ranks services with an explainable score. Here both halves are pure TS: the
// whole incident is a function of (scenario, seed). No network, no eval, no
// wall clock.

import { hexId, mulberry32, randInt } from './prng';
import type {
  Cluster,
  Evidence,
  Incident,
  LogLine,
  RankedService,
  Scenario,
  ServiceName,
} from './types';

// Request path through the simulated system, entry first.
export const CHAIN: ServiceName[] = ['gateway', 'orders', 'payments', 'db'];

// Baseline p95 latency per service in ms, before the incident.
const BASELINE_P95: Record<ServiceName, number> = {
  gateway: 120,
  orders: 90,
  payments: 110,
  db: 40,
};

type ScenarioSpec = {
  culprit: ServiceName;
  // p95 multiple applied to the culprit during the window
  spike: number;
  // error templates per service; {ms} and {id} are the variable parts the
  // normalizer strips when it turns a raw line into a signature
  errorTemplate: Partial<Record<ServiceName, string>>;
};

const SPECS: Record<Scenario, ScenarioSpec> = {
  'payments-outage': {
    culprit: 'payments',
    spike: 4.2,
    errorTemplate: {
      gateway: 'POST /checkout -> 502 (req {id})',
      orders: 'create order failed: payments unavailable (req {id})',
      payments: 'charge card failed: upstream timeout after {ms}ms (req {id})',
    },
  },
  'db-slowdown': {
    culprit: 'db',
    spike: 3.8,
    errorTemplate: {
      gateway: 'POST /checkout -> 504 (req {id})',
      orders: 'order lookup timed out (req {id})',
      payments: 'ledger write timed out after {ms}ms (req {id})',
      db: 'query latency {ms}ms exceeds budget (stmt {id})',
    },
  },
};

const HEALTHY_TEMPLATE: Record<ServiceName, string> = {
  gateway: 'POST /checkout -> 200 in {ms}ms (req {id})',
  orders: 'order created in {ms}ms (req {id})',
  payments: 'charge captured in {ms}ms (req {id})',
  db: 'query ok in {ms}ms (stmt {id})',
};

// Fill a template's variable slots from the PRNG to make one raw line.
function fill(template: string, rnd: () => number, slowMs?: number): string {
  const ms = slowMs ?? randInt(rnd, 12, 96);
  return template
    .replace('{ms}', String(ms))
    .replace('{id}', hexId(rnd, 6));
}

// The normalizer: what diagkit does to group raw lines into signatures. The
// demo keeps the template as the ground truth, so normalize(fill(t)) === t by
// construction; this function documents the mechanism the collapse animation
// shows.
export function normalize(raw: string): string {
  return raw
    .replace(/\b\d+ms\b/g, '{ms}ms')
    .replace(/\b(req|stmt) [0-9a-f]{6}\b/g, '$1 {id}');
}

function p95(sorted: number[]): number {
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx];
}

export function buildIncident(scenario: Scenario, seed: number): Incident {
  const rnd = mulberry32(seed);
  const spec = SPECS[scenario];
  const culpritIdx = CHAIN.indexOf(spec.culprit);

  const requests = 120;
  const failFraction = 0.7;
  const failing = Math.round(requests * failFraction);

  // Per-service tallies driven by simulated entry requests.
  const errorLines: Record<ServiceName, number> = { gateway: 0, orders: 0, payments: 0, db: 0 };
  const touched: Record<ServiceName, number> = { gateway: 0, orders: 0, payments: 0, db: 0 };
  const failTouched: Record<ServiceName, number> = { gateway: 0, orders: 0, payments: 0, db: 0 };
  const latencies: Record<ServiceName, number[]> = { gateway: [], orders: [], payments: [], db: [] };

  const lines: LogLine[] = [];
  const clusterKey = new Map<string, number>();
  const clusters: Cluster[] = [];
  let lineSeq = 0;

  function record(service: ServiceName, template: string, error: boolean, slowMs?: number) {
    let idx = clusterKey.get(service + '|' + template);
    if (idx === undefined) {
      idx = clusters.length;
      clusterKey.set(service + '|' + template, idx);
      clusters.push({ signature: template, service, count: 0, error });
    }
    clusters[idx].count += 1;
    lines.push({
      id: 'l' + lineSeq++,
      service,
      raw: fill(template, rnd, slowMs),
      clusterIdx: idx,
      error,
    });
  }

  for (let r = 0; r < requests; r++) {
    const fails = r < failing;
    // A failing request reaches the culprit; a few also touch the next hop
    // before the failure lands, which is why the downstream service keeps a
    // small entry-error share instead of zero.
    const depth = fails
      ? Math.min(CHAIN.length - 1, culpritIdx + (rnd() < 0.06 ? 1 : 0))
      : CHAIN.length - 1;
    for (let s = 0; s <= depth; s++) {
      const svc = CHAIN[s];
      touched[svc] += 1;
      if (fails) failTouched[svc] += 1;
      const base = BASELINE_P95[svc];
      const slow = fails && s <= culpritIdx;
      const mult = slow ? (s === culpritIdx ? spec.spike : 1 + (spec.spike - 1) * 0.25) : 1;
      latencies[svc].push(Math.round(base * mult * (0.55 + rnd() * 0.5)));
      const errTemplate = spec.errorTemplate[svc];
      if (fails && s <= culpritIdx && errTemplate) {
        errorLines[svc] += 1;
        record(svc, errTemplate, true, Math.round(base * mult));
      } else if (rnd() < 0.22) {
        record(svc, HEALTHY_TEMPLATE[svc], false);
      }
    }
  }

  // Rank with the explainable score: signature density, latency spike,
  // error rate, entry-error propagation. Each component is kept on the
  // evidence object so the UI can show why a service ranks where it does.
  const spikes = {} as Record<ServiceName, number>;
  for (const svc of CHAIN) {
    const sorted = [...latencies[svc]].sort((a, b) => a - b);
    spikes[svc] = sorted.length ? p95(sorted) / BASELINE_P95[svc] : 1;
  }
  const maxSig = Math.max(1, ...CHAIN.map((s) => errorLines[s]));
  const maxSpike = Math.max(1.001, ...CHAIN.map((s) => spikes[s]));

  const raw: { service: ServiceName; score: number; evidence: Evidence }[] = CHAIN.map((svc) => {
    const evidence: Evidence = {
      signatureLines: errorLines[svc],
      latencySpikeX: Math.round(spikes[svc] * 10) / 10,
      errorRate: touched[svc] ? Math.round((errorLines[svc] / touched[svc]) * 100) / 100 : 0,
      entryErrorShare: failing ? Math.round((failTouched[svc] / failing) * 100) / 100 : 0,
    };
    const score =
      0.35 * (errorLines[svc] / maxSig) +
      0.3 * Math.max(0, (spikes[svc] - 1) / (maxSpike - 1)) +
      0.2 * evidence.errorRate +
      0.15 * evidence.entryErrorShare;
    return { service: svc, score, evidence };
  });

  const top = Math.max(...raw.map((r) => r.score));
  const ranked: RankedService[] = raw
    .map((r) => ({ ...r, score: Math.round((r.score / top) * 1000) / 1000 }))
    .sort((a, b) => b.score - a.score || a.service.localeCompare(b.service));

  // Order clusters error-first then by density, remapping each line's cluster
  // index so the collapse animation still points at the right row.
  const order = clusters
    .map((_, i) => i)
    .sort(
      (a, b) =>
        Number(clusters[b].error) - Number(clusters[a].error) ||
        clusters[b].count - clusters[a].count,
    );
  const newIdx = new Map(order.map((oldIdx, pos) => [oldIdx, pos]));
  const sortedClusters = order.map((i) => clusters[i]);
  const remapped = lines.map((l) => ({ ...l, clusterIdx: newIdx.get(l.clusterIdx) ?? 0 }));

  // Stream a readable sample: interleave a slice of the full line list so the
  // demo shows a mix of services and severities in arrival order.
  const step = Math.max(1, Math.floor(remapped.length / 14));
  const sampleLines = remapped.filter((_, i) => i % step === 0).slice(0, 14);

  return {
    scenario,
    seed,
    culprit: spec.culprit,
    totalLines: remapped.length,
    sampleLines,
    clusters: sortedClusters,
    ranked,
  };
}
