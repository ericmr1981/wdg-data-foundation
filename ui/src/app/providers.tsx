'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BrandProvider, BRAND_OPTIONS, useBrand } from '@/lib/brand-context';
import { fetchBrands } from '@/lib/brands-client';

function BrandSelector() {
  const { brand, setBrand } = useBrand();
  const [opts, setOpts] = useState<Array<{ code: string; name: string }>>(Array.from(BRAND_OPTIONS));

  useEffect(() => {
    fetchBrands()
      .then((rows) => {
        if (!rows.length) return;
        setOpts(rows.map((r) => ({ code: r.brand_code, name: r.brand_name })));
      })
      .catch(() => {});
  }, []);

  return (
    <select
      value={brand}
      onChange={(e) => setBrand(e.target.value as any)}
      className="ml-4 text-sm border border-gray-300 rounded px-2 py-1 bg-white"
    >
      {opts.map((b) => (
        <option key={b.code} value={b.code}>
          {b.name}
        </option>
      ))}
    </select>
  );
}

function NavBar() {
  const [me, setMe] = useState<{ username: string; role: string } | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    // login page doesn't need auth — skip to avoid redirect loop
    if (pathname === '/login') return;

    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) {
          // stale / expired cookie — hard redirect to login
          window.location.href = '/login';
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (d?.success) setMe(d.data);
      })
      .catch(() => {
        window.location.href = '/login';
      });
  }, [pathname]);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  return (
    <nav className="bg-white shadow-sm border-b">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex justify-between h-14">
          <div className="flex space-x-8 items-center">
            <Link href="/" className="inline-flex items-center px-1 pt-1 text-sm font-medium text-gray-900 hover:text-blue-600">
              首页
            </Link>
            <Link href="/pipeline" className="inline-flex items-center px-1 pt-1 text-sm font-medium text-gray-500 hover:text-blue-600">
              Pipeline 监控
            </Link>
            <Link href="/rules" className="inline-flex items-center px-1 pt-1 text-sm font-medium text-gray-500 hover:text-blue-600">
              规则管理
            </Link>
            <Link href="/match" className="inline-flex items-center px-1 pt-1 text-sm font-medium text-gray-500 hover:text-blue-600">
              人工匹配
            </Link>
            <Link href="/upload" className="inline-flex items-center px-1 pt-1 text-sm font-medium text-gray-500 hover:text-blue-600">
              文件上传
            </Link>
            <Link href="/financial" className="inline-flex items-center px-1 pt-1 text-sm font-medium text-gray-500 hover:text-blue-600">
              财务报表
            </Link>
            <Link href="/payment" className="inline-flex items-center px-1 pt-1 text-sm font-medium text-gray-500 hover:text-blue-600">
              付款分析
            </Link>
            <Link href="/income" className="inline-flex items-center px-1 pt-1 text-sm font-medium text-gray-500 hover:text-blue-600">
              收入分析
            </Link>

            {me?.role === 'admin' && (
              <Link href="/admin/config" className="inline-flex items-center px-1 pt-1 text-sm font-medium text-gray-500 hover:text-blue-600">
                配置
              </Link>
            )}
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">品牌:</span>
            <BrandSelector />

            {me && (
              <span className="text-xs text-gray-500">{me.username} ({me.role})</span>
            )}

            <button onClick={logout} className="text-xs border rounded px-2 py-1 bg-white hover:bg-gray-50">
              退出
            </button>
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
