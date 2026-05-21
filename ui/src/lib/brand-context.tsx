'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

type Brand = string;

interface BrandContextType {
  brand: Brand;
  setBrand: (brand: Brand) => void;
}

const BrandContext = createContext<BrandContextType | undefined>(undefined);

export function BrandProvider({ children }: { children: ReactNode }) {
  const [brand, setBrand] = useState<Brand>('gelatomiiix');

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
  { code: 'gelatomiiix', name: '蜜可诗' }
] as const;

// NOTE: dynamic brand list (C2) is loaded via /api/brands at runtime.
