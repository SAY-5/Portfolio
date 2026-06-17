// Seed catalog for the in-browser DataFinder explorer. In a real system this
// would live in a search index behind a service; here it is a static,
// deterministic seed so the whole app runs in the browser with no network. The
// set spans a few categories and overlapping tags so faceting, counts, and
// sorting all have something meaningful to work with.

import type { Record } from './types';

export const CATALOG: Record[] = [
  { id: 'kb-87', name: 'Tenkeyless Mechanical Keyboard', category: 'Peripherals', tags: ['wireless', 'usb-c', 'rgb'], price: 119, rating: 4.6, year: 2024, blurb: '87-key hot-swap board with USB-C and per-key lighting.' },
  { id: 'ms-12', name: 'Ergonomic Vertical Mouse', category: 'Peripherals', tags: ['wireless', 'bluetooth'], price: 64, rating: 4.2, year: 2023, blurb: 'Vertical grip mouse with low-latency wireless.' },
  { id: 'mn-27', name: '27-inch QHD Monitor', category: 'Displays', tags: ['hdr', 'usb-c', '4k'], price: 329, rating: 4.5, year: 2024, blurb: '1440p 165Hz panel with USB-C input and HDR.' },
  { id: 'mn-32', name: '32-inch 4K Monitor', category: 'Displays', tags: ['hdr', '4k', 'usb-c'], price: 549, rating: 4.7, year: 2025, blurb: 'Large 4K display with hardware HDR and a built-in hub.' },
  { id: 'hs-09', name: 'Over-ear Studio Headset', category: 'Audio', tags: ['wireless', 'noise-cancel'], price: 178, rating: 4.4, year: 2023, blurb: 'Closed-back headset with active noise cancelling.' },
  { id: 'sp-04', name: 'Desktop Bookshelf Speakers', category: 'Audio', tags: ['bluetooth', 'usb-c'], price: 142, rating: 4.1, year: 2022, blurb: 'Compact powered speakers with Bluetooth and USB-C.' },
  { id: 'wc-02', name: '1080p Webcam', category: 'Peripherals', tags: ['usb-c', 'auto-framing'], price: 54, rating: 3.9, year: 2022, blurb: 'Auto-framing webcam with a privacy shutter.' },
  { id: 'wc-4k', name: '4K Conference Webcam', category: 'Peripherals', tags: ['4k', 'usb-c', 'auto-framing'], price: 149, rating: 4.3, year: 2024, blurb: 'Wide-angle 4K webcam tuned for meeting rooms.' },
  { id: 'dk-04', name: 'USB-C Docking Station', category: 'Connectivity', tags: ['usb-c', 'thunderbolt'], price: 219, rating: 4.0, year: 2023, blurb: '11-port dock with 100W passthrough charging.' },
  { id: 'hb-07', name: '7-in-1 USB-C Hub', category: 'Connectivity', tags: ['usb-c', 'hdmi'], price: 39, rating: 3.8, year: 2021, blurb: 'Slim travel hub with HDMI and card readers.' },
  { id: 'rt-ax', name: 'Wi-Fi 6 Mesh Router', category: 'Networking', tags: ['wifi6', 'mesh'], price: 189, rating: 4.2, year: 2023, blurb: 'Tri-band mesh node with Wi-Fi 6 and app setup.' },
  { id: 'sw-08', name: '8-port Gigabit Switch', category: 'Networking', tags: ['gigabit', 'managed'], price: 72, rating: 4.4, year: 2022, blurb: 'Managed gigabit switch with VLAN support.' },
  { id: 'nas-2', name: '2-bay Network Storage', category: 'Storage', tags: ['nas', 'gigabit'], price: 299, rating: 4.5, year: 2024, blurb: 'Two-bay NAS with snapshots and an app suite.' },
  { id: 'ssd-1', name: '1TB NVMe SSD', category: 'Storage', tags: ['nvme', 'pcie4'], price: 89, rating: 4.8, year: 2024, blurb: 'PCIe 4.0 drive rated for sustained writes.' },
  { id: 'ssd-2', name: '2TB Portable SSD', category: 'Storage', tags: ['usb-c', 'portable'], price: 159, rating: 4.6, year: 2023, blurb: 'Pocket SSD with USB-C and hardware encryption.' },
  { id: 'kb-60', name: '60% Wireless Keyboard', category: 'Peripherals', tags: ['wireless', 'bluetooth', 'rgb'], price: 99, rating: 4.0, year: 2023, blurb: 'Compact 60% board with Bluetooth and lighting.' },
  { id: 'ms-pro', name: 'Pro Gaming Mouse', category: 'Peripherals', tags: ['wireless', 'rgb'], price: 129, rating: 4.7, year: 2025, blurb: 'Lightweight wireless mouse with a 30K sensor.' },
  { id: 'mn-ul', name: '34-inch Ultrawide Monitor', category: 'Displays', tags: ['ultrawide', 'usb-c', 'hdr'], price: 729, rating: 4.6, year: 2025, blurb: 'Curved ultrawide with USB-C and HDR.' },
  { id: 'mic-01', name: 'USB Condenser Microphone', category: 'Audio', tags: ['usb-c', 'podcast'], price: 119, rating: 4.3, year: 2023, blurb: 'Cardioid USB-C mic with a built-in gain dial.' },
  { id: 'amp-01', name: 'Headphone DAC and Amp', category: 'Audio', tags: ['usb-c', 'hi-res'], price: 199, rating: 4.5, year: 2024, blurb: 'Desktop DAC and amp with balanced output.' },
  { id: 'cam-act', name: 'Action Camera', category: 'Cameras', tags: ['4k', 'waterproof'], price: 249, rating: 4.1, year: 2022, blurb: 'Stabilised 4K action camera with waterproof body.' },
  { id: 'cam-mir', name: 'Mirrorless Camera Body', category: 'Cameras', tags: ['4k', 'aps-c'], price: 899, rating: 4.7, year: 2024, blurb: 'APS-C mirrorless body with in-body stabilisation.' },
  { id: 'lens-35', name: '35mm Prime Lens', category: 'Cameras', tags: ['prime', 'aps-c'], price: 379, rating: 4.6, year: 2023, blurb: 'Fast 35mm prime with quiet autofocus.' },
  { id: 'tab-11', name: '11-inch Tablet', category: 'Mobile', tags: ['usb-c', 'stylus'], price: 599, rating: 4.4, year: 2024, blurb: 'Slim tablet with stylus support and a laminated screen.' },
  { id: 'pen-01', name: 'Active Stylus Pen', category: 'Mobile', tags: ['stylus', 'bluetooth'], price: 89, rating: 4.2, year: 2023, blurb: 'Pressure-sensitive stylus with tilt support.' },
  { id: 'pwr-65', name: '65W GaN Charger', category: 'Power', tags: ['usb-c', 'gan'], price: 45, rating: 4.5, year: 2024, blurb: 'Three-port GaN charger that fits in a pocket.' },
  { id: 'pwr-bk', name: '20000mAh Power Bank', category: 'Power', tags: ['usb-c', 'portable'], price: 59, rating: 4.3, year: 2023, blurb: 'High-capacity bank with USB-C fast charging.' },
  { id: 'cb-15', name: 'Braided USB-C Cable', category: 'Connectivity', tags: ['usb-c', 'portable'], price: 17, rating: 4.4, year: 2022, blurb: '240W-rated 1.5m cable with a right-angle plug.' },
  { id: 'st-30', name: 'Aluminium Laptop Stand', category: 'Accessories', tags: ['aluminium', 'portable'], price: 42, rating: 4.2, year: 2021, blurb: 'Folding vented stand that travels flat.' },
  { id: 'arm-01', name: 'Single Monitor Arm', category: 'Accessories', tags: ['aluminium', 'vesa'], price: 78, rating: 4.5, year: 2023, blurb: 'Gas-spring VESA arm with cable management.' },
  { id: 'pad-xl', name: 'XL Desk Mat', category: 'Accessories', tags: ['fabric', 'rgb'], price: 29, rating: 4.1, year: 2022, blurb: 'Stitched-edge desk mat with optional lighting.' },
  { id: 'kvm-2', name: '2-port KVM Switch', category: 'Connectivity', tags: ['usb-c', 'hdmi'], price: 109, rating: 4.0, year: 2023, blurb: 'Single-cable KVM for two USB-C machines.' },
  { id: 'eth-25', name: '2.5G Ethernet Adapter', category: 'Networking', tags: ['usb-c', 'gigabit'], price: 35, rating: 4.3, year: 2024, blurb: 'USB-C to 2.5G Ethernet for fast wired links.' },
  { id: 'sdr-01', name: 'UHS-II SD Card', category: 'Storage', tags: ['portable', 'uhs-ii'], price: 49, rating: 4.6, year: 2023, blurb: 'Fast UHS-II card for camera burst shooting.' },
  { id: 'ups-1', name: '600VA Desktop UPS', category: 'Power', tags: ['battery', 'surge'], price: 99, rating: 4.2, year: 2022, blurb: 'Line-interactive UPS for a workstation.' },
  { id: 'spk-pt', name: 'Portable Bluetooth Speaker', category: 'Audio', tags: ['bluetooth', 'waterproof', 'portable'], price: 79, rating: 4.4, year: 2024, blurb: 'Rugged waterproof speaker with long battery life.' },
  { id: 'mn-pt', name: 'Portable USB-C Monitor', category: 'Displays', tags: ['usb-c', 'portable'], price: 199, rating: 4.0, year: 2023, blurb: '15-inch travel display powered over a single cable.' },
  { id: 'gpu-eg', name: 'eGPU Enclosure', category: 'Connectivity', tags: ['thunderbolt', 'pcie4'], price: 329, rating: 3.9, year: 2022, blurb: 'Thunderbolt enclosure for an external graphics card.' },
  { id: 'kb-er', name: 'Split Ergonomic Keyboard', category: 'Peripherals', tags: ['wireless', 'split', 'rgb'], price: 199, rating: 4.5, year: 2025, blurb: 'Two-piece ergonomic board with tenting feet.' },
  { id: 'cam-dr', name: 'Dash Camera', category: 'Cameras', tags: ['4k', 'waterproof'], price: 139, rating: 4.0, year: 2023, blurb: 'Front 4K dash cam with parking mode.' },
  { id: 'hub-tb', name: 'Thunderbolt 4 Dock', category: 'Connectivity', tags: ['thunderbolt', 'usb-c', 'hdmi'], price: 279, rating: 4.4, year: 2025, blurb: 'Full-bandwidth Thunderbolt 4 dock with dual display.' },
];

export function findRecord(id: string): Record | undefined {
  return CATALOG.find((r) => r.id === id);
}

export function money(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}
