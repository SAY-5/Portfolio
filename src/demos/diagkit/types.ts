// Shared types for the diagkit demo. Everything downstream of the engine is a
// pure function of (scenario, seed), so these shapes carry no timestamps or
// runtime state, only derived incident data.

export type Scenario = 'payments-outage' | 'db-slowdown';

export type ServiceName = 'gateway' | 'orders' | 'payments' | 'db';

// One raw log line as the collector would see it, before normalization.
export type LogLine = {
  id: string;
  service: ServiceName;
  raw: string;
  // index into the incident's cluster list once normalized
  clusterIdx: number;
  error: boolean;
};

// A normalized signature cluster: one template covering many raw lines.
export type Cluster = {
  signature: string;
  service: ServiceName;
  count: number;
  error: boolean;
};

// The explainable evidence behind one service's rank.
export type Evidence = {
  // raw log lines covered by this service's error signatures
  signatureLines: number;
  // p95 latency during the incident divided by baseline p95
  latencySpikeX: number;
  // peak fraction of this service's requests that errored, 0..1
  errorRate: number;
  // fraction of failing entry (gateway) requests whose trace passes through
  // this service, 0..1
  entryErrorShare: number;
};

export type RankedService = {
  service: ServiceName;
  score: number; // 0..1, top service normalized to 1
  evidence: Evidence;
};

export type Incident = {
  scenario: Scenario;
  seed: number;
  culprit: ServiceName;
  totalLines: number;
  // the sample of raw lines the demo streams in, in arrival order
  sampleLines: LogLine[];
  clusters: Cluster[];
  ranked: RankedService[];
};
