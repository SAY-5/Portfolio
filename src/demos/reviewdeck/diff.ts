// Safe diff parser -- no eval, pure string operations.
// Accepts unified diff text and returns structured FilePatch objects.

import type { FilePatch, HunkLine } from './types';

// Parse a unified diff into FilePatch[]
// Handles standard `--- a/...` / `+++ b/...` headers and @@ hunk markers.
export function parseDiff(raw: string): FilePatch[] {
  const lines = raw.split('\n');
  const patches: FilePatch[] = [];
  let current: FilePatch | null = null;
  let currentHunk: HunkLine[] | null = null;

  for (const line of lines) {
    // Detect new file header
    if (line.startsWith('--- ')) {
      // Push the previous patch if any
      if (current) {
        if (currentHunk && currentHunk.length > 0) {
          current.hunks.push(currentHunk);
        }
        patches.push(current);
      }
      currentHunk = null;
      // Path is after 'a/' prefix when present
      const raw_path = line.slice(4);
      const path = raw_path.startsWith('a/') ? raw_path.slice(2) : raw_path;
      current = { path, added: 0, removed: 0, hunks: [] };
      continue;
    }

    // Override path with the +++ line (more reliable for new files)
    if (line.startsWith('+++ ') && current) {
      const raw_path = line.slice(4);
      const path = raw_path.startsWith('b/') ? raw_path.slice(2) : raw_path;
      // Only update if it is a real path, not /dev/null
      if (path !== '/dev/null') {
        current.path = path;
      }
      continue;
    }

    // Hunk header: @@ -a,b +c,d @@
    if (line.startsWith('@@ ') && current) {
      if (currentHunk && currentHunk.length > 0) {
        current.hunks.push(currentHunk);
      }
      currentHunk = [];
      continue;
    }

    if (!current || currentHunk === null) continue;

    if (line.startsWith('+') && !line.startsWith('+++')) {
      const text = line.slice(1);
      currentHunk.push({ kind: 'added', text });
      current.added++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      const text = line.slice(1);
      currentHunk.push({ kind: 'removed', text });
      current.removed++;
    } else if (line.startsWith(' ') || line === '') {
      currentHunk.push({ kind: 'context', text: line.startsWith(' ') ? line.slice(1) : '' });
    }
    // Skip "\ No newline at end of file" and other meta lines
  }

  // Flush last patch
  if (current) {
    if (currentHunk && currentHunk.length > 0) {
      current.hunks.push(currentHunk);
    }
    patches.push(current);
  }

  return patches;
}

// Summarise diff stats: total added, removed lines across all files.
export function diffStats(patches: FilePatch[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const p of patches) {
    added += p.added;
    removed += p.removed;
  }
  return { added, removed };
}

// Sample diff that can be pre-loaded so the demo works without pasting.
export const SAMPLE_DIFF = `--- a/src/auth/session.ts
+++ b/src/auth/session.ts
@@ -1,10 +1,14 @@
 import { randomBytes } from 'crypto';
+import { DB } from '../db';

-const SESSION_TTL = 3600;
+const SESSION_TTL = 7200;
+const MAX_SESSIONS_PER_USER = 5;

 export function createSession(userId: string): string {
   const token = randomBytes(32).toString('hex');
-  store.set(token, { userId, exp: Date.now() + SESSION_TTL * 1000 });
+  pruneOldSessions(userId);
+  DB.sessions.insert({ token, userId, exp: Date.now() + SESSION_TTL * 1000 });
   return token;
 }
+
+function pruneOldSessions(userId: string): void {
+  const rows = DB.sessions.findByUser(userId);
+  if (rows.length >= MAX_SESSIONS_PER_USER) {
+    rows.sort((a, b) => a.exp - b.exp);
+    DB.sessions.delete(rows[0].token);
+  }
+}
--- a/src/auth/middleware.ts
+++ b/src/auth/middleware.ts
@@ -4,8 +4,10 @@
 import { DB } from '../db';

 export function requireAuth(req: Request, res: Response, next: NextFunction) {
-  const token = req.headers['x-token'] as string | undefined;
-  if (!token) return res.status(401).json({ error: 'missing token' });
-  const session = store.get(token);
-  if (!session || session.exp < Date.now()) {
+  const header = req.headers['authorization'] ?? '';
+  const token = header.startsWith('Bearer ') ? header.slice(7) : req.headers['x-token'] as string | undefined;
+  if (!token) return res.status(401).json({ error: 'unauthorized' });
+  const session = DB.sessions.findByToken(token);
+  if (!session || session.exp < Date.now()) {
+    if (session) DB.sessions.delete(token);
     return res.status(401).json({ error: 'invalid or expired token' });
   }
   req.userId = session.userId;
`;
