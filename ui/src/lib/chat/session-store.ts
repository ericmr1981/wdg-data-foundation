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

const store = new Map<string, ChatSession>();
let lastSweep = Date.now();

function sweepIfStale() {
  const now = Date.now();
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [id, sess] of store) {
    if (now - sess.updatedAt > TTL_MS) store.delete(id);
  }
}

export function getOrCreateSession(userId: string): ChatSession {
  sweepIfStale();
  // Find the most recent session for this user (v1: single session per user).
  let latest: ChatSession | null = null;
  for (const sess of store.values()) {
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
  store.set(sess.id, sess);
  return sess;
}

export function getSession(id: string): ChatSession | undefined {
  sweepIfStale();
  return store.get(id);
}

export function updateSession(id: string, patch: Partial<ChatSession>): void {
  const sess = store.get(id);
  if (!sess) return;
  Object.assign(sess, patch, { updatedAt: Date.now() });
}

export function appendMessage(id: string, msg: ChatMessage): void {
  const sess = store.get(id);
  if (!sess) return;
  sess.messages.push(msg);
  sess.updatedAt = Date.now();
}

export function resetSession(id: string): void {
  const sess = store.get(id);
  if (!sess) return;
  sess.messages = [];
  sess.context = {};
  sess.updatedAt = Date.now();
}

/** For tests: clear all sessions. */
export function _clearAllForTests(): void {
  store.clear();
  lastSweep = Date.now();
}
