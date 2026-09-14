// Port of conduit/core/queue.py against an in-memory SQS: visibility timeout,
// ApproximateReceiveCount, redrive into the dead-letter queue after
// maxReceiveCount, and replay. The worker never acknowledges a failed
// delivery, so exhaustion is the only way into the DLQ; quarantine is a
// separate queue the worker writes to itself.
import type { Envelope } from './models';

export interface QueueMessage {
  messageId: string;
  envelope: Envelope;
  receiveCount: number;
  visibleAt: number;
  replays: number;
}

export class Queue {
  readonly name: string;
  readonly messages: QueueMessage[] = [];
  dlq: Queue | null = null;
  maxReceiveCount = 3;
  private seq = 0;
  private readonly clock: () => number;
  private readonly visibilityTimeout: number;

  constructor(name: string, clock: () => number, visibilityTimeout: number) {
    this.name = name;
    this.clock = clock;
    this.visibilityTimeout = visibilityTimeout;
  }

  send(envelope: Envelope, replays = 0): string {
    const messageId = `${this.name.replace('conduit-', '')}-${(++this.seq).toString(36).padStart(4, '0')}`;
    this.messages.push({ messageId, envelope, receiveCount: 0, visibleAt: this.clock(), replays });
    return messageId;
  }

  // A message already received maxReceiveCount times is moved by the queue itself.
  receive(max = 10, visibility?: number): QueueMessage[] {
    const now = this.clock();
    const out: QueueMessage[] = [];
    for (const m of this.messages.slice()) {
      if (out.length >= max) break;
      if (m.visibleAt > now) continue;
      if (this.dlq && m.receiveCount >= this.maxReceiveCount) {
        this.messages.splice(this.messages.indexOf(m), 1);
        this.dlq.messages.push({ ...m, visibleAt: now });
        continue;
      }
      m.receiveCount += 1;
      m.visibleAt = now + (visibility ?? this.visibilityTimeout);
      out.push(m);
    }
    return out;
  }

  changeVisibility(messageId: string, seconds: number): void {
    const m = this.messages.find((x) => x.messageId === messageId);
    if (m) m.visibleAt = this.clock() + Math.max(0, Math.min(43200, seconds));
  }

  delete(messageId: string): void {
    const idx = this.messages.findIndex((x) => x.messageId === messageId);
    if (idx >= 0) this.messages.splice(idx, 1);
  }

  depth(): { visible: number; inFlight: number } {
    const now = this.clock();
    const visible = this.messages.filter((m) => m.visibleAt <= now).length;
    return { visible, inFlight: this.messages.length - visible };
  }
}

// conduit dlq replay: back onto the work queue with attempt + 1 and a fresh receive count.
export function replayDeadLetters(dlq: Queue, target: Queue): QueueMessage[] {
  const moved = dlq.messages.splice(0, dlq.messages.length);
  for (const m of moved) target.send({ ...m.envelope, attempt: m.envelope.attempt + 1 }, m.replays + 1);
  return moved;
}
