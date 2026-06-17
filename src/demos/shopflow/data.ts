// Catalog seed for the in-browser ShopFlow storefront. In the real system the
// catalog service owns this data in its own Postgres database and exposes it
// through the gateway. Here it is a static seed so the storefront runs fully in
// the browser. Stock is the on-hand count the saga reserves against per line.

export type Product = {
  sku: string;
  name: string;
  blurb: string;
  price: number; // unit price in whole currency units
  stock: number; // units on hand the order saga can reserve
};

export const CURRENCY = 'USD';

export const catalog: Product[] = [
  {
    sku: 'KB-87',
    name: 'Tenkeyless Mechanical Keyboard',
    blurb: '87 keys, hot-swap switches, USB-C',
    price: 119,
    stock: 14,
  },
  {
    sku: 'MS-12',
    name: 'Wireless Ergonomic Mouse',
    blurb: '12 programmable buttons, low latency',
    price: 64,
    stock: 22,
  },
  {
    sku: 'PD-04',
    name: 'USB-C Docking Pad',
    blurb: '4 ports, 100W passthrough charging',
    price: 89,
    stock: 9,
  },
  {
    sku: 'MN-27',
    name: '27 inch QHD Monitor',
    blurb: '1440p, 165Hz, height adjustable',
    price: 329,
    stock: 6,
  },
  {
    sku: 'HS-09',
    name: 'Over-ear Headset',
    blurb: 'Noise isolating, detachable boom mic',
    price: 78,
    stock: 18,
  },
  {
    sku: 'WC-02',
    name: '1080p Webcam',
    blurb: 'Auto framing, privacy shutter',
    price: 54,
    stock: 11,
  },
  {
    sku: 'CB-15',
    name: 'Braided USB-C Cable',
    blurb: '1.5m, 240W rated, right-angle',
    price: 17,
    stock: 40,
  },
  {
    sku: 'ST-30',
    name: 'Adjustable Laptop Stand',
    blurb: 'Aluminium, folds flat, vented',
    price: 42,
    stock: 7,
  },
];

export function findProduct(sku: string): Product | undefined {
  return catalog.find((p) => p.sku === sku);
}

export function money(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: CURRENCY,
    maximumFractionDigits: 0,
  }).format(amount);
}
