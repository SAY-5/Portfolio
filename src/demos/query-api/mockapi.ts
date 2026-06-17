// A self-contained mock REST backend that resolves entirely in the browser.
// It owns a small in-memory dataset (users and orders) and a router that
// matches a method plus path against a fixed set of endpoints using plain
// string parsing: no eval, no Function, no regular-expression routing of
// untrusted input, and no real fetch. Each handler returns a realistic status
// code and a JSON-serialisable body. The router is pure with respect to its
// inputs except for POST /users, which appends to the in-memory user list so a
// follow-up GET /users reflects the create.

import type { MockRequest, MockResponse } from './types';

export type User = {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'member' | 'viewer';
};

export type Order = {
  id: number;
  userId: number;
  total: number;
  status: 'pending' | 'paid' | 'shipped' | 'cancelled';
};

// Seed data. The router reads from a working copy so a reset can restore it.
const SEED_USERS: User[] = [
  { id: 1, name: 'Ada Lovelace', email: 'ada@example.com', role: 'admin' },
  { id: 2, name: 'Alan Turing', email: 'alan@example.com', role: 'member' },
  { id: 3, name: 'Grace Hopper', email: 'grace@example.com', role: 'member' },
  { id: 4, name: 'Katherine Johnson', email: 'katherine@example.com', role: 'viewer' },
];

const SEED_ORDERS: Order[] = [
  { id: 1001, userId: 1, total: 240, status: 'paid' },
  { id: 1002, userId: 2, total: 99, status: 'pending' },
  { id: 1003, userId: 1, total: 540, status: 'shipped' },
  { id: 1004, userId: 3, total: 12, status: 'cancelled' },
  { id: 1005, userId: 2, total: 320, status: 'paid' },
];

const ORDER_STATUSES = new Set(['pending', 'paid', 'shipped', 'cancelled']);

let users: User[] = SEED_USERS.map((u) => ({ ...u }));
let orders: Order[] = SEED_ORDERS.map((o) => ({ ...o }));

// Restore the dataset to its seed state. Used by the console reset control so
// a POST that added a user does not leak across sessions.
export function resetData(): void {
  users = SEED_USERS.map((u) => ({ ...u }));
  orders = SEED_ORDERS.map((o) => ({ ...o }));
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function ok(body: unknown, status = 200, statusText = 'OK'): MockResponse {
  return { status, statusText, headers: { ...JSON_HEADERS }, body };
}

function fail(status: number, statusText: string, message: string): MockResponse {
  return { status, statusText, headers: { ...JSON_HEADERS }, body: { error: message } };
}

// Split a path into clean segments, tolerating a leading slash, a trailing
// slash, and any query string the caller left attached.
function segments(path: string): string[] {
  const noQuery = path.split('?')[0];
  return noQuery.split('/').filter((s) => s.length > 0);
}

// Validate the body of POST /users. Returns a typed user on success or a list
// of human-readable problems. Kept deliberately strict so the validation note
// in the viewer has something concrete to show.
function validateNewUser(body: unknown): { user: Omit<User, 'id'> } | { errors: string[] } {
  const errors: string[] = [];
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { errors: ['body must be a JSON object'] };
  }
  const record = body as Record<string, unknown>;

  const name = record.name;
  if (typeof name !== 'string' || name.trim().length === 0) {
    errors.push('name is required and must be a non-empty string');
  }

  const email = record.email;
  if (typeof email !== 'string' || !email.includes('@') || email.length < 3) {
    errors.push('email is required and must look like an address');
  }

  const role = record.role ?? 'member';
  if (role !== 'admin' && role !== 'member' && role !== 'viewer') {
    errors.push('role must be one of admin, member, viewer');
  }

  if (errors.length > 0) return { errors };
  return {
    user: {
      name: (name as string).trim(),
      email: email as string,
      role: role as User['role'],
    },
  };
}

// The router. Matches on method and parsed segments only; never interprets the
// path as code. Returns 404 for anything it does not recognise and 405 when a
// known path is hit with the wrong method.
export function route(req: MockRequest): MockResponse {
  const parts = segments(req.path);

  // Collection root.
  if (parts.length === 1 && parts[0] === 'users') {
    if (req.method === 'GET') return ok(users.map((u) => ({ ...u })));
    if (req.method === 'POST') {
      const result = validateNewUser(req.body);
      if ('errors' in result) {
        return fail(400, 'Bad Request', result.errors.join('; '));
      }
      const id = users.reduce((max, u) => Math.max(max, u.id), 0) + 1;
      const created: User = { id, ...result.user };
      users = [...users, created];
      return ok(created, 201, 'Created');
    }
    return fail(405, 'Method Not Allowed', `${req.method} not supported on /users`);
  }

  // Single user by id.
  if (parts.length === 2 && parts[0] === 'users') {
    if (req.method !== 'GET') {
      return fail(405, 'Method Not Allowed', `${req.method} not supported on /users/:id`);
    }
    const id = Number(parts[1]);
    if (!Number.isInteger(id)) {
      return fail(400, 'Bad Request', 'user id must be an integer');
    }
    const user = users.find((u) => u.id === id);
    if (!user) return fail(404, 'Not Found', `no user with id ${id}`);
    return ok({ ...user });
  }

  // Orders, optionally filtered by ?status=.
  if (parts.length === 1 && parts[0] === 'orders') {
    if (req.method !== 'GET') {
      return fail(405, 'Method Not Allowed', `${req.method} not supported on /orders`);
    }
    const status = req.query.status;
    if (status !== undefined && status.length > 0) {
      if (!ORDER_STATUSES.has(status)) {
        return fail(400, 'Bad Request', `unknown status filter: ${status}`);
      }
      return ok(orders.filter((o) => o.status === status).map((o) => ({ ...o })));
    }
    return ok(orders.map((o) => ({ ...o })));
  }

  return fail(404, 'Not Found', `no route for ${req.method} ${'/' + parts.join('/')}`);
}

// A short catalogue the UI uses to seed example requests and label routes.
export const ROUTES = [
  { method: 'GET' as const, path: '/users', label: 'List users' },
  { method: 'GET' as const, path: '/users/1', label: 'Get user by id' },
  { method: 'GET' as const, path: '/orders', label: 'List orders' },
  { method: 'POST' as const, path: '/users', label: 'Create user' },
];
