// Port of conduit/core/idempotency.py. The key is
// sha256("v1|<connector>|<task id>|<task version>"); claim() is a conditional
// PutItem with attribute_not_exists(pk) OR (state = in_progress AND
// lease_until < now), so a key that was already delivered can never be claimed
// again and the duplicate is acknowledged without calling the target.
import { sha256Hex } from './sha256';

export const keyMaterial = (connector: string, taskId: string, version: number) => `v1|${connector}|${taskId}|${version}`;
export const idempotencyKey = (connector: string, taskId: string, version: number) => sha256Hex(keyMaterial(connector, taskId, version));

interface Item {
  state: 'in_progress' | 'delivered';
  connector: string;
  taskId: string;
  leaseUntil: number;
  remoteId: string | null;
}

export class IdempotencyStore {
  readonly items = new Map<string, Item>();
  conditionalFailures = 0;
  private readonly latestIds = new Map<string, string>();
  private readonly clock: () => number;
  private readonly leaseSeconds = 120;

  constructor(clock: () => number) {
    this.clock = clock;
  }

  claim(key: string, connector: string, taskId: string): { acquired: boolean; state: Item['state'] | null; remoteId: string | null } {
    const now = this.clock();
    const existing = this.items.get(key);
    if (existing && !(existing.state === 'in_progress' && existing.leaseUntil < now)) {
      this.conditionalFailures += 1;
      return { acquired: false, state: existing.state, remoteId: existing.remoteId };
    }
    this.items.set(key, { state: 'in_progress', connector, taskId, leaseUntil: now + this.leaseSeconds, remoteId: null });
    return { acquired: true, state: 'in_progress', remoteId: null };
  }

  markDelivered(key: string, remoteId: string | null): void {
    const item = this.items.get(key);
    if (!item) return;
    item.state = 'delivered';
    item.remoteId = remoteId;
    if (remoteId) this.latestIds.set(`latest|${item.connector}|${item.taskId}`, remoteId);
  }

  // A redrive or replay can only deliver once the in-progress claim is dropped.
  release(key: string): void {
    if (this.items.get(key)?.state === 'in_progress') this.items.delete(key);
  }

  latest(connector: string, taskId: string): string | null {
    return this.latestIds.get(`latest|${connector}|${taskId}`) ?? null;
  }
}
