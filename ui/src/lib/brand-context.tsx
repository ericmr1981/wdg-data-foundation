'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type Brand = string;

interface BrandContextType {
  brand: Brand;
  setBrand: (brand: Brand) => void;
}

const BrandContext = createContext<BrandContextType | undefined>(undefined);

// Cookie is the authoritative brand source (readable from RSC via getBrandServer).
// localStorage is kept as a client-side fallback / backwards-compat layer.
export const BRAND_COOKIE_NAME = 'wdg.brand';
const STORAGE_KEY = 'wdg.brand';
const DEFAULT_BRAND = 'tamkoko';
const COOKIE_MAX_AGE = 31536000; // 1 year

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  const parts = document.cookie.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return null;
}

function writeCookie(name: string, value: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

export function BrandProvider({ children }: { children: ReactNode }) {
  const [brand, setBrandState] = useState<Brand>(DEFAULT_BRAND);

  // Hydrate from cookie (authoritative) on mount, falling back to localStorage.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const fromCookie = readCookie(BRAND_COOKIE_NAME);
    if (fromCookie) {
      setBrandState(fromCookie);
      // Keep localStorage in sync (legacy readers, if any)
      try { window.localStorage.setItem(STORAGE_KEY, fromCookie); } catch {}
      return;
    }
    const fromStorage = window.localStorage.getItem(STORAGE_KEY);
    if (fromStorage) {
      setBrandState(fromStorage);
      // Promote legacy localStorage value into the cookie (one-time migration)
      writeCookie(BRAND_COOKIE_NAME, fromStorage);
    }
  }, []);

  const setBrand = (b: Brand) => {
    setBrandState(b);
    if (typeof window !== 'undefined') {
      writeCookie(BRAND_COOKIE_NAME, b);
      try { window.localStorage.setItem(STORAGE_KEY, b); } catch {}
    }
  };

  return (
    <BrandContext.Provider value={{ brand, setBrand }}>
      {children}
    </BrandContext.Provider>
  );
}

export function useBrand() {
  const context = useContext(BrandContext);
  if (!context) {
    throw new Error('useBrand must be used within a BrandProvider');
  }
  return context;
}

export const BRAND_OPTIONS = [
  { code: 'tamkoko', name: '泰柯茶园' },
  { code: 'gelatomiiix', name: '蜜可诗' },
  { code: 'bonjur', name: 'Bonjour' }
] as const;

// NOTE: dynamic brand list (C2) is loaded via /api/brands at runtime.
