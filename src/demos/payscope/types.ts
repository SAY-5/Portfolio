export type Meter = {
  id: string;
  name: string;
  unit: string;
  ratePerUnit: number;
};

export type UsageEvent = {
  id: string;
  meterId: string;
  quantity: number;
  timestamp: number;
  idempotencyKey: string;
};

export type PlanMeter = {
  meterId: string;
  includedQuota: number;
  overageRate: number;
};

export type Plan = {
  id: string;
  name: string;
  meters: PlanMeter[];
};

export type InvoiceLineItem = {
  meterName: string;
  meterUnit: string;
  totalUsage: number;
  includedQuota: number;
  overageUsage: number;
  overageRate: number;
  charge: number;
};

export type Invoice = {
  id: string;
  planId: string;
  planName: string;
  periodStart: number;
  periodEnd: number;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  generatedAt: number;
};
