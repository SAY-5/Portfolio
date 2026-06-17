// Small formatting helpers shared across the portal UI.
import type { Status } from './types';

export function formatDate(at: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(at));
}

export function statusLabel(status: Status): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'paused':
      return 'Paused';
    case 'pending_cancel':
      return 'Cancels at period end';
    case 'canceled':
      return 'Canceled';
  }
}
