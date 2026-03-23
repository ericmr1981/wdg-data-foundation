'use client';

import React from 'react';
import Link from 'next/link';
import { BrandProvider, BRAND_OPTIONS, useBrand } from '@/lib/brand-context';

function BrandSelector() {
  const { brand, setBrand } = useBrand();

  return (
    <select
      value={brand}
      onChange={(e) => setBrand(e.target.value as 'yufeng' | 'bonjur')}
      className="ml-4 text-sm border border-gray-300 rounded px-2 py-1 bg-white"
    >
      {BRAND_OPTIONS.map((b) => (
        <option key={b.code} value={b.code}>
          {b.name}
        </option>
      ))}
    </select>
  );
}

function NavBar() {
  return (
    <nav className="bg-white shadow-sm border-b">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex justify-between h-14">
          <div className="flex space-x-8 items-center">
            <Link
              href="/"
              className="inline-flex items-center px-1 pt-1 text-sm font-medium text-gray-900 hover:text-blue-600"
            >
              首页
            </Link>
            <Link
              href="/pipeline"
              className="inline-flex items-center px-1 pt-1 text-sm font-medium text-gray-500 hover:text-blue-600"
            >
              Pipeline 监控
            </Link>
            <Link
              href="/rules"
              className="inline-flex items-center px-1 pt-1 text-sm font-medium text-gray-500 hover:text-blue-600"
            >
              规则管理
            </Link>
            <Link
              href="/match"
              className="inline-flex items-center px-1 pt-1 text-sm font-medium text-gray-500 hover:text-blue-600"
            >
              人工匹配
            </Link>
            <Link
              href="/upload"
              className="inline-flex items-center px-1 pt-1 text-sm font-medium text-gray-500 hover:text-blue-600"
            >
              文件上传
            </Link>
          </div>
          <div className="flex items-center">
            <span className="text-sm text-gray-500">品牌:</span>
            <BrandSelector />
          </div>
        </div>
      </div>
    </nav>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <BrandProvider>
      <NavBar />
      {children}
    </BrandProvider>
  );
}
