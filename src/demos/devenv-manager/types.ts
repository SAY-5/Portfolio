// Domain types for the dev-services manager. A Service is a named local
// process bound to a port, started by a command, that may depend on other
// services. Status moves stopped -> starting -> running as the engine brings a
// service and its dependencies up in topological order.

export type ServiceStatus = 'stopped' | 'starting' | 'running';

export type Service = {
  id: string;
  name: string;
  port: number;
  command: string;
  // ids of services this one depends on. A service only starts once every
  // dependency is running.
  dependsOn: string[];
  status: ServiceStatus;
};

// A dependency edge that would close a loop in the graph, surfaced so the UI
// can explain why an add-dependency request was rejected.
export type CycleError = {
  from: string; // the service the edge was added to
  to: string; // the dependency that would create the cycle
  path: string[]; // the existing path to -> ... -> from that closes the loop
};

// Two or more services configured on the same port. Local processes cannot
// share a port, so these are flagged before anything is started.
export type PortConflict = {
  port: number;
  serviceIds: string[];
};
