// Money helpers. All amounts inside the engine and store are integer minor
// units (cents). These functions are the only place that bridges between minor
// units and the human-facing decimal string, so the UI never does float math.

import { CURRENCY_EXPONENT, type Currency } from './types';

// Format minor units as a major-unit string with the currency's decimal places.
// 1234 USD -> "12.34", 1234 JPY -> "1234".
export function formatMinor(minor: number, currency: Currency): string {
  const exp = CURRENCY_EXPONENT[currency];
  if (exp === 0) return String(minor);
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const divisor = 10 ** exp;
  const whole = Math.floor(abs / divisor);
  const frac = (abs % divisor).toString().padStart(exp, '0');
  return `${sign}${whole}.${frac}`;
}

// Format with the currency code appended, for display labels.
export function formatMoney(minor: number, currency: Currency): string {
  return `${formatMinor(minor, currency)} ${currency}`;
}

// Parse a human major-unit string into integer minor units. Returns null for
// anything that is not a clean non-negative number, so the form can reject bad
// input rather than coerce it.
export function parseMajor(input: string, currency: Currency): number | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const exp = CURRENCY_EXPONENT[currency];
  const [whole, frac = ''] = trimmed.split('.');
  if (frac.length > exp) return null;
  const padded = frac.padEnd(exp, '0');
  const minor = Number(whole) * 10 ** exp + (exp === 0 ? 0 : Number(padded));
  if (!Number.isInteger(minor) || minor <= 0) return null;
  return minor;
}
