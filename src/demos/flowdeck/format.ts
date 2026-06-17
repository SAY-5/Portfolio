// Small formatting helpers shared by the FlowDeck UI. Kept pure and dependency
// free so they can be reasoned about and reused across panels.

// A compact relative age such as "just now", "12m", "3h", "2d".
export function age(from: number, now: number = Date.now()): string {
  const ms = Math.max(0, now - from);
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}

// A wall-clock time of day for audit lines, e.g. "14:08".
export function clock(at: number): string {
  const d = new Date(at);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

// Render a field value for display.
export function fieldText(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}
