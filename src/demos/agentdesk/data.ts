// Mock backend for the in-browser AgentDesk console. In the real system these
// tools are HTTP calls the provider layer makes through the operations gateway
// against the orders, billing, and customer services. Here they run fully in
// the browser over a static seed so the console works offline. Each tool can
// succeed or fail at run time; the fraction that succeed is the tool-call
// completeness that, multiplied by the provider signal, gives the confidence
// that decides resolve-or-escalate.

export type Customer = {
  id: string;
  name: string;
  tier: 'standard' | 'priority';
  address: string;
};

export type OrderRecord = {
  id: string;
  customerId: string;
  item: string;
  total: number; // whole currency units
  placedDaysAgo: number;
  status: 'shipped' | 'delivered' | 'processing';
  refundable: boolean; // inside the return window and not already refunded
};

// Intents the queue can carry. Each intent maps to a fixed tool plan the agent
// runs in order; see PLANS below.
export type Intent =
  | 'order_status'
  | 'refund_request'
  | 'address_change'
  | 'cancel_order';

export type Request = {
  id: string;
  customerId: string;
  intent: Intent;
  orderId?: string;
  text: string;
  // Per-request provider signal: how confident the provider layer is in the
  // resolution it drafted, independent of whether the tools succeed. Held in the
  // 0..1 range; weak signals pull the final confidence below the threshold even
  // when every tool succeeds.
  signal: number;
  // Optional new address payload for address_change intents.
  newAddress?: string;
};

export type ToolName =
  | 'lookup_order'
  | 'check_refund_eligibility'
  | 'issue_refund'
  | 'update_address';

export type ToolSpec = {
  name: ToolName;
  label: string;
  blurb: string;
};

export const CURRENCY = 'USD';
export const DEFAULT_THRESHOLD = 0.7;

// The tools the provider layer can call. Order matters within a plan: a refund
// is only issued after eligibility is confirmed.
export const tools: ToolSpec[] = [
  {
    name: 'lookup_order',
    label: 'lookup_order',
    blurb: 'Read the order record from the orders service',
  },
  {
    name: 'check_refund_eligibility',
    label: 'check_refund_eligibility',
    blurb: 'Confirm the order is inside the return window',
  },
  {
    name: 'issue_refund',
    label: 'issue_refund',
    blurb: 'Post a refund to the billing service',
  },
  {
    name: 'update_address',
    label: 'update_address',
    blurb: 'Write the new shipping address to the customer record',
  },
];

// Fixed tool plan per intent. The agent runs these in order against the backend.
export const PLANS: Record<Intent, ToolName[]> = {
  order_status: ['lookup_order'],
  refund_request: ['lookup_order', 'check_refund_eligibility', 'issue_refund'],
  address_change: ['lookup_order', 'update_address'],
  cancel_order: ['lookup_order', 'check_refund_eligibility'],
};

export const customers: Customer[] = [
  { id: 'C-1042', name: 'Mara Okafor', tier: 'priority', address: '4 Linden Way, Leeds' },
  { id: 'C-2185', name: 'Devin Park', tier: 'standard', address: '88 Harbor St, Bristol' },
  { id: 'C-3390', name: 'Lena Vargas', tier: 'standard', address: '12 Foss Lane, York' },
  { id: 'C-4471', name: 'Theo Bauer', tier: 'priority', address: '301 Mill Rd, Bath' },
];

export const orders: OrderRecord[] = [
  {
    id: 'O-58120',
    customerId: 'C-1042',
    item: 'Tenkeyless Keyboard',
    total: 119,
    placedDaysAgo: 5,
    status: 'delivered',
    refundable: true,
  },
  {
    id: 'O-58144',
    customerId: 'C-2185',
    item: 'QHD Monitor',
    total: 329,
    placedDaysAgo: 41,
    status: 'delivered',
    refundable: false, // outside the 30 day return window
  },
  {
    id: 'O-58210',
    customerId: 'C-3390',
    item: 'Wireless Mouse',
    total: 64,
    placedDaysAgo: 2,
    status: 'shipped',
    refundable: true,
  },
  {
    id: 'O-58233',
    customerId: 'C-4471',
    item: 'Docking Pad',
    total: 89,
    placedDaysAgo: 9,
    status: 'processing',
    refundable: true,
  },
];

// The inbound queue the operator works through. Signals are tuned so the seed
// produces a mix: strong-signal requests with clean tool runs auto-resolve,
// while weak-signal or ineligible ones land below the threshold and escalate.
export const inbound: Request[] = [
  {
    id: 'R-4815',
    customerId: 'C-1042',
    intent: 'order_status',
    orderId: 'O-58120',
    text: 'Where is my keyboard order? It said delivered but I want to confirm.',
    signal: 0.95,
  },
  {
    id: 'R-4816',
    customerId: 'C-3390',
    intent: 'refund_request',
    orderId: 'O-58210',
    text: 'The mouse arrived with a faulty scroll wheel, I would like a refund.',
    signal: 0.9,
  },
  {
    id: 'R-4817',
    customerId: 'C-2185',
    intent: 'refund_request',
    orderId: 'O-58144',
    text: 'I want a refund on the monitor I bought a couple of months ago.',
    signal: 0.88,
  },
  {
    id: 'R-4818',
    customerId: 'C-4471',
    intent: 'address_change',
    orderId: 'O-58233',
    text: 'Please ship the docking pad to my new place: 19 Castle View, Bath.',
    signal: 0.82,
    newAddress: '19 Castle View, Bath',
  },
  {
    id: 'R-4819',
    customerId: 'C-3390',
    intent: 'cancel_order',
    orderId: 'O-58210',
    text: 'Actually cancel the mouse if it has not shipped yet, not sure though.',
    signal: 0.58,
  },
  {
    id: 'R-4820',
    customerId: 'C-1042',
    intent: 'order_status',
    text: 'Did my recent order go through? I never got a number for it.',
    signal: 0.62,
  },
];

export function findCustomer(id: string): Customer | undefined {
  return customers.find((c) => c.id === id);
}

export function findOrder(id: string | undefined): OrderRecord | undefined {
  if (!id) return undefined;
  return orders.find((o) => o.id === id);
}

export function intentLabel(intent: Intent): string {
  switch (intent) {
    case 'order_status':
      return 'Order status';
    case 'refund_request':
      return 'Refund request';
    case 'address_change':
      return 'Address change';
    case 'cancel_order':
      return 'Cancel order';
  }
}

export function money(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: CURRENCY,
    maximumFractionDigits: 0,
  }).format(amount);
}
