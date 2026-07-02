// FNV-1a 32-bit over chunk content, standing in for snapvault's from-scratch
// SHA-256. The property the demo needs is the same one the real engine relies
// on: identical content always hashes to the identical address, so dedup,
// placement, and per-chunk verification are all pure functions of content.

export function fnv1a32(content: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// Compact display form: six hex digits, the way the CLI prints chunk ids.
export function shortHex(content: string): string {
  return fnv1a32(content).toString(16).padStart(8, '0').slice(0, 6);
}
