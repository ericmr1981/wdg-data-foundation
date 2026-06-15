// ui/src/lib/chat/use-drawer-state.ts
'use client';
import { useEffect, useState, useCallback, useRef } from 'react';

// 持久化键：使用 sessionStorage，浏览器关闭后状态自动清空。
// 这样用户每次重新登录/打开浏览器时 AI 窗口都是收起状态，
// 但在同一浏览器会话内用户主动展开/关闭的偏好仍会保留。
const KEY = 'wdg.chat.drawer.v1';
const MIN_W = 320;
const MAX_W = 640;
const DEF_W = 420;

interface Persisted {
  open: boolean;
  width: number;
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage;
}

function readPersisted(): Persisted | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<Persisted>;
    const width = typeof j.width === 'number' && j.width >= MIN_W && j.width <= MAX_W
      ? j.width : DEF_W;
    const open = !!j.open;
    return { open, width };
  } catch {
    return null;
  }
}

function writePersisted(p: Persisted): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify(p));
  } catch {
    // private mode / quota — ignore
  }
}

export interface UseDrawerStateResult {
  open: boolean;
  width: number;
  setOpen: (v: boolean) => void;
  setWidth: (v: number) => void;
  toggle: () => void;
}

export function useDrawerState(): UseDrawerStateResult {
  // SSR-safe defaults; hydrate from localStorage on first effect.
  const [open, setOpenState] = useState(false);
  const [width, setWidthState] = useState(DEF_W);

  // Keep refs in sync with state so the callbacks below can read the latest
  // values without depending on state in their useCallback deps — this keeps
  // the callback identities stable across renders (callers like
  // useEffect([toggle]) won't churn listeners on every state change).
  const openRef = useRef(open);
  const widthRef = useRef(width);
  openRef.current = open;
  widthRef.current = width;

  useEffect(() => {
    const p = readPersisted();
    if (p) {
      setOpenState(p.open);
      setWidthState(p.width);
    }
  }, []);

  const setOpen = useCallback((v: boolean) => {
    setOpenState(v);
    writePersisted({ open: v, width: widthRef.current });
  }, []);

  const setWidth = useCallback((v: number) => {
    const clamped = Math.max(MIN_W, Math.min(MAX_W, v));
    setWidthState(clamped);
    writePersisted({ open: openRef.current, width: clamped });
  }, []);

  const toggle = useCallback(() => setOpen(!openRef.current), []);

  return { open, width, setOpen, setWidth, toggle };
}

export const DRAWER_LIMITS = { MIN_W, MAX_W, DEF_W };
