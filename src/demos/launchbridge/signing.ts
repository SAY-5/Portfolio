// Request signing shared by inbound verification and outbound delivery. The
// signed message is `<unix seconds>.<raw body>`; binding the timestamp into the
// digest lets a receiver reject stale requests without keeping every nonce.
import { hmacSha256, sha256, toHex, utf8 } from './crypto';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function serialize(value: Json, sortKeys: boolean, itemSep: string, keySep: string): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map((v) => serialize(v, sortKeys, itemSep, keySep)).join(itemSep) + ']';
  const keys = Object.keys(value);
  if (sortKeys) keys.sort();
  return '{' + keys.map((k) => JSON.stringify(k) + keySep + serialize(value[k], sortKeys, itemSep, keySep)).join(itemSep) + '}';
}

// json.dumps(value) with Python's default separators.
export function pyDumps(value: Json): string {
  return serialize(value, false, ', ', ': ');
}

// json.dumps(value, sort_keys=True, separators=(",", ":")), the outbound envelope.
export function canonicalJson(value: Json): string {
  return serialize(value, true, ',', ':');
}

export function parseJson(text: string): Json | undefined {
  try {
    return JSON.parse(text) as Json;
  } catch {
    return undefined;
  }
}

export const SIGNATURE_HEADER = 'X-Signature';
export const TIMESTAMP_HEADER = 'X-Timestamp';
export const IDEMPOTENCY_HEADER = 'X-Idempotency-Key';
export const EVENT_ID_HEADER = 'X-Event-Id';
export const SIGNATURE_PREFIX = 'sha256=';

export type RejectionReason =
  | 'missing_timestamp'
  | 'invalid_timestamp'
  | 'stale_timestamp'
  | 'missing_signature'
  | 'invalid_signature'
  | 'replayed_signature';

export function signedMessage(timestamp: number | string, body: string): string {
  return `${timestamp}.${body}`;
}

export function computeSignature(secret: string, timestamp: number | string, body: string): string {
  return SIGNATURE_PREFIX + hmacSha256(secret, signedMessage(timestamp, body));
}

export function signHeaders(secret: string, body: string, timestamp: number): Record<string, string> {
  const ts = Math.floor(timestamp);
  return { [TIMESTAMP_HEADER]: String(ts), [SIGNATURE_HEADER]: computeSignature(secret, ts, body) };
}

// Constant-time comparison, the counterpart of hmac.compare_digest.
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = utf8(a);
  const bb = utf8(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length, 1);
  for (let i = 0; i < n; i++) {
    diff |= (ab[i % Math.max(ab.length, 1)] ?? 0) ^ (bb[i % Math.max(bb.length, 1)] ?? 0);
  }
  return diff === 0;
}

export function contentHash(body: string): string {
  return toHex(sha256(utf8(body)));
}

export type StepId = 'timestamp' | 'window' | 'header' | 'hmac' | 'nonce' | 'dedup';

export interface VerifyStep {
  id: StepId;
  label: string;
  ok: boolean;
  detail: string;
}

export interface Verification {
  ok: boolean;
  timestamp: number | null;
  reason: RejectionReason | null;
  detail: string;
  expected: string | null;
  steps: VerifyStep[];
}

// verify_signature, reported step by step. Checks run in the service's order
// and stop at the first failure, which names the rejection reason.
export function verifySignature(
  secret: string,
  timestampHeader: string | undefined,
  signatureHeader: string | undefined,
  body: string,
  toleranceSeconds: number,
  nowSeconds: number,
): Verification {
  const steps: VerifyStep[] = [];
  const fail = (id: StepId, label: string, reason: RejectionReason, detail: string, expected: string | null = null): Verification => {
    steps.push({ id, label, ok: false, detail: `${reason}: ${detail}` });
    return { ok: false, timestamp: null, reason, detail, expected, steps };
  };
  const tsLabel = `${TIMESTAMP_HEADER} is unix seconds`;
  if (!timestampHeader) return fail('timestamp', tsLabel, 'missing_timestamp', `${TIMESTAMP_HEADER} header is required`);
  const trimmed = timestampHeader.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return fail('timestamp', tsLabel, 'invalid_timestamp', 'timestamp must be unix seconds');
  const timestamp = Number.parseInt(trimmed, 10);
  steps.push({ id: 'timestamp', label: tsLabel, ok: true, detail: String(timestamp) });

  const skew = nowSeconds - timestamp;
  const windowLabel = `|now - timestamp| <= ${toleranceSeconds} s`;
  if (Math.abs(skew) > toleranceSeconds) {
    return fail('window', windowLabel, 'stale_timestamp', `timestamp outside the ${toleranceSeconds}s tolerance window (skew ${skew} s)`);
  }
  steps.push({ id: 'window', label: windowLabel, ok: true, detail: `skew ${skew} s` });

  const headerLabel = `${SIGNATURE_HEADER} starts with ${SIGNATURE_PREFIX}`;
  if (!signatureHeader) return fail('header', headerLabel, 'missing_signature', `${SIGNATURE_HEADER} header is required`);
  if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) return fail('header', headerLabel, 'invalid_signature', `signature must start with ${SIGNATURE_PREFIX}`);
  steps.push({ id: 'header', label: headerLabel, ok: true, detail: 'present' });

  const expected = computeSignature(secret, timestamp, body);
  const hmacLabel = 'HMAC-SHA256(secret, "<timestamp>.<body>") matches, constant time';
  if (!timingSafeEqual(expected, signatureHeader)) return fail('hmac', hmacLabel, 'invalid_signature', 'signature does not match body', expected);
  steps.push({ id: 'hmac', label: hmacLabel, ok: true, detail: 'digest equal' });
  return { ok: true, timestamp, reason: null, detail: '', expected, steps };
}
