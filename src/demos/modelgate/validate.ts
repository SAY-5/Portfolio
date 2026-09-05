// Port of the strict /predict schema: every field is checked before a tensor
// is built, and each failure carries a field, a reason, and a message. The
// reasons are the label values of modelgate_input_rejections_total.

export type Reason =
  | 'out_of_range'
  | 'not_finite'
  | 'wrong_type'
  | 'unknown_zone'
  | 'unknown_field'
  | 'missing_field'
  | 'malformed_body';

export type Rejection = { field: string; reason: Reason; message: string };

export const REASONS: Reason[] = [
  'out_of_range',
  'not_finite',
  'wrong_type',
  'unknown_zone',
  'unknown_field',
  'missing_field',
  'malformed_body',
];

export const FIELDS = [
  'distance_km',
  'hour_of_day',
  'day_of_week',
  'pickup_zone_id',
  'traffic_index',
  'is_raining',
] as const;

export type Field = (typeof FIELDS)[number];

export type PredictInput = {
  distance_km: number;
  hour_of_day: number;
  day_of_week: number;
  pickup_zone_id: number;
  traffic_index: number;
  is_raining: boolean;
};

export const ZONES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

function checkFloat(
  field: string,
  v: unknown,
  lo: number,
  hi: number,
  out: Rejection[],
): void {
  if (typeof v !== 'number' || typeof v === 'boolean') {
    out.push({ field, reason: 'wrong_type', message: `${field} must be a float` });
    return;
  }
  if (!Number.isFinite(v)) {
    out.push({ field, reason: 'not_finite', message: `${field} must be finite` });
    return;
  }
  if (v < lo || v > hi) {
    out.push({
      field,
      reason: 'out_of_range',
      message: `${field} must be between ${lo} and ${hi}`,
    });
  }
}

function checkInt(
  field: string,
  v: unknown,
  lo: number,
  hi: number,
  out: Rejection[],
): void {
  if (!isInt(v)) {
    out.push({ field, reason: 'wrong_type', message: `${field} must be an int` });
    return;
  }
  if (v < lo || v > hi) {
    out.push({
      field,
      reason: 'out_of_range',
      message: `${field} must be between ${lo} and ${hi}`,
    });
  }
}

// Pure: same payload, same rejections. Returns [] when the body is accepted.
export function validate(payload: Record<string, unknown>): Rejection[] {
  const out: Rejection[] = [];
  for (const key of Object.keys(payload)) {
    if (!(FIELDS as readonly string[]).includes(key)) {
      out.push({ field: key, reason: 'unknown_field', message: `${key} is not a known field` });
    }
  }
  for (const f of FIELDS) {
    if (!(f in payload)) {
      out.push({ field: f, reason: 'missing_field', message: `${f} is required` });
    }
  }
  if ('distance_km' in payload) checkFloat('distance_km', payload.distance_km, 0, 500, out);
  if ('hour_of_day' in payload) checkInt('hour_of_day', payload.hour_of_day, 0, 23, out);
  if ('day_of_week' in payload) checkInt('day_of_week', payload.day_of_week, 0, 6, out);
  if ('pickup_zone_id' in payload) {
    const z = payload.pickup_zone_id;
    if (!isInt(z)) {
      out.push({ field: 'pickup_zone_id', reason: 'wrong_type', message: 'pickup_zone_id must be an int' });
    } else if (!ZONES.includes(z)) {
      out.push({
        field: 'pickup_zone_id',
        reason: 'unknown_zone',
        message: `zone ${z} is not in the manifest (1..12)`,
      });
    }
  }
  if ('traffic_index' in payload) checkFloat('traffic_index', payload.traffic_index, 0, 1, out);
  if ('is_raining' in payload && typeof payload.is_raining !== 'boolean') {
    out.push({
      field: 'is_raining',
      reason: 'wrong_type',
      message: 'is_raining must be a strict bool (1 is not accepted)',
    });
  }
  return out;
}
