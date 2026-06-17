// Deterministic seed for the streamcatalog. A fresh seed is built on first load
// and after a reset. Schema-version history is fixed (no clock reads here) so
// the catalog renders identically every time; `registeredAt: 0` marks a seeded
// version, and live registrations stamp a real time from the UI snapshot.

import type { Topic } from './types';

export function seedTopics(): Topic[] {
  return [
    {
      id: 'orders',
      name: 'orders.events',
      description: 'Customer order lifecycle events from the commerce platform.',
      versions: [
        {
          version: 1,
          registeredAt: 0,
          note: 'initial schema',
          fields: [
            { name: 'orderId', type: 'string', required: true },
            { name: 'customerId', type: 'string', required: true },
            { name: 'amount', type: 'int', required: true },
            { name: 'status', type: 'string', required: true },
          ],
        },
        {
          version: 2,
          registeredAt: 0,
          note: 'backward compatible',
          fields: [
            { name: 'orderId', type: 'string', required: true },
            { name: 'customerId', type: 'string', required: true },
            { name: 'amount', type: 'long', required: true },
            { name: 'status', type: 'string', required: true },
            { name: 'currency', type: 'string', required: false },
          ],
        },
      ],
      producers: [{ id: 'prod-orders-1', name: 'checkout-service' }],
      consumers: [
        { id: 'cons-orders-1', name: 'fulfilment-worker' },
        { id: 'cons-orders-2', name: 'analytics-sink' },
      ],
    },
    {
      id: 'payments',
      name: 'payments.captured',
      description: 'Settled payment captures emitted by the billing gateway.',
      versions: [
        {
          version: 1,
          registeredAt: 0,
          note: 'initial schema',
          fields: [
            { name: 'paymentId', type: 'string', required: true },
            { name: 'orderId', type: 'string', required: true },
            { name: 'amount', type: 'long', required: true },
            { name: 'captured', type: 'boolean', required: true },
          ],
        },
      ],
      producers: [{ id: 'prod-pay-1', name: 'billing-gateway' }],
      consumers: [{ id: 'cons-pay-1', name: 'ledger-writer' }],
    },
    {
      id: 'telemetry',
      name: 'device.telemetry',
      description: 'High-volume sensor readings from edge devices.',
      versions: [
        {
          version: 1,
          registeredAt: 0,
          note: 'initial schema',
          fields: [
            { name: 'deviceId', type: 'string', required: true },
            { name: 'timestamp', type: 'long', required: true },
            { name: 'temperature', type: 'double', required: true },
            { name: 'payload', type: 'bytes', required: false },
          ],
        },
      ],
      producers: [
        { id: 'prod-tel-1', name: 'edge-agent' },
        { id: 'prod-tel-2', name: 'gateway-bridge' },
      ],
      consumers: [{ id: 'cons-tel-1', name: 'metrics-rollup' }],
    },
  ];
}
