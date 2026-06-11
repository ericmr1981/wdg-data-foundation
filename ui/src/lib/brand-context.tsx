'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type Brand = string;

interface BrandContextType {
  brand: Brand;
  setBrand: (brand: Brand) => void;
}

const BrandContext = createContext<BrandContextType | undefined>(undefined);
const STORAGE_KEY = 'wdg.brand';
const DEFAULT_BRAND = 'tamkoko';

export function BrandProvider({ children }: { children: ReactNode }) {
  const [brand, setBrandState] = useState<Brand>(DEFAULT_BRAND);

  // Hydrate from localStorage on mount (client-only)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) setBrandState(stored);
  }, []);

  const setBrand = (b: Brand) => {
    setBrandState(b);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, b);
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
