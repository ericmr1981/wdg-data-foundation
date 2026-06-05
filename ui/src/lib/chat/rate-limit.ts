// ui/src/lib/chat/rate-limit.ts
// Spec §8: 60s window, max 10 messages per user. In-memory.

const WINDOW_MS = 60_000;
const MAX = 10;
const hits = new Map<string, number[]>();

export function checkRateLimit(userId: string): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const arr = (hits.get(userId) ?? []).filter(t => now - t < WINDOW_MS);
  if (arr.length >= MAX) {
    return { ok: false, retryAfterSec: Math.ceil((WINDOW_MS - (now - arr[0])) / 1000) };
  }
  arr.push(now);
  hits.set(userId, arr);
  return { ok: true };
}

export function _clearForTests(): void { hits.clear(); }
