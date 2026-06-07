// ui/src/lib/chat/session-store.ts
// Spec §7: in-memory chat history, 30-min TTL. Not persisted in v1.

import { randomUUID } from 'crypto';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: Array<{ id: string; name: string; input: unknown; result?: string; isError?: boolean }>;
  ts: number;
}

export interface ChatSession {
  id: string;
  userId: string;
  context: { brand?: string; store?: string; period?: string; page?: string };
  messages: ChatMessage[];
  updatedAt: number;
}

const TTL_MS = 30 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

// Backing store lives on globalThis to survive Next.js dev HMR re-evaluation.
// Without this, when chat route (or any other consumer) gets recompiled,
// the module-level Map is reinitialized to empty and all in-flight chat
// history is silently lost. See agent-config-store.ts for the same pattern.
type SessionStore = { map: Map<string, ChatSession>; lastSweep: number };
const STORE_KEY = '__wdg_session_store__';
const g = globalThis as unknown as { [STORE_KEY]?: SessionStore };
const store: SessionStore = (g[STORE_KEY] ??= { map: new Map(), lastSweep: Date.now() });

function sweepIfStale() {
  const now = Date.now();
  if (now - store.lastSweep < SWEEP_INTERVAL_MS) return;
  store.lastSweep = now;
  for (const [id, sess] of store.map) {
    if (now - sess.updatedAt > TTL_MS) store.map.delete(id);
  }
}

export function getOrCreateSession(userId: string): ChatSession {
  sweepIfStale();
  // Find the most recent session for this user (v1: single session per user).
  let latest: ChatSession | null = null;
  for (const sess of store.map.values()) {
    if (sess.userId !== userId) continue;
    if (!latest || sess.updatedAt > latest.updatedAt) latest = sess;
  }
  if (latest) return latest;
  const sess: ChatSession = {
    id: randomUUID(),
    userId,
    context: {},
    messages: [],
    updatedAt: Date.now(),
  };
  store.map.set(sess.id, sess);
  return sess;
}

export function getSession(id: string): ChatSession | undefined {
  sweepIfStale();
  return store.map.get(id);
}

export function updateSession(id: string, patch: Partial<ChatSession>): void {
  const sess = store.map.get(id);
  if (!sess) return;
  Object.assign(sess, patch, { updatedAt: Date.now() });
}

export function appendMessage(id: string, msg: ChatMessage): void {
  const sess = store.map.get(id);
  if (!sess) return;
  sess.messages.push(msg);
  sess.updatedAt = Date.now();
}

export function resetSession(id: string): void {
  const sess = store.map.get(id);
  if (!sess) return;
  sess.messages = [];
  sess.context = {};
  sess.updatedAt = Date.now();
}

/** For tests: clear all sessions. */
export function _clearAllForTests(): void {
  store.map.clear();
  store.lastSweep = Date.now();
}
