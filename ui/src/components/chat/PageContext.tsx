// ui/src/components/chat/PageContext.tsx
'use client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { PageContextValue } from './types';

const Ctx = createContext<PageContextValue>({});

export function usePageContext() { return useContext(Ctx); }

/**
 * Derives { brand, store, period, page } from window.location on every
 * navigation. Posts deltas to /api/chat/context.
 */
export function PageContextProvider({ children }: { children: ReactNode }) {
  const [ctx, setCtx] = useState<PageContextValue>({});

  useEffect(() => {
    function readFromUrl() {
      if (typeof window === 'undefined') return;
      const url = new URL(window.location.href);
      const page = url.pathname.replace(/^\/u\//, '').split('/')[0] || '<none>';
      setCtx({
        brand:  url.searchParams.get('brand')  ?? undefined,
        store:  url.searchParams.get('store')  ?? undefined,
        period: url.searchParams.get('period') ?? undefined,
        page,
      });
    }
    readFromUrl();
    window.addEventListener('popstate', readFromUrl);
    // Patch pushState/replaceState to fire 'popstate' on SPA nav.
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function (...a) { origPush.apply(this, a); window.dispatchEvent(new PopStateEvent('popstate')); };
    history.replaceState = function (...a) { origReplace.apply(this, a); window.dispatchEvent(new PopStateEvent('popstate')); };
    return () => {
      window.removeEventListener('popstate', readFromUrl);
      history.pushState = origPush;
      history.replaceState = origReplace;
    };
  }, []);

  // Push context to server on every change
  useEffect(() => {
    if (Object.keys(ctx).length === 0) return;
    fetch('/api/chat/context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: ctx }),
    }).catch(() => { /* offline / logged out — ignore */ });
  }, [ctx.brand, ctx.store, ctx.period, ctx.page]);

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}
