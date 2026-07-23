'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BrandProvider, BRAND_OPTIONS, useBrand } from '@/lib/brand-context';
import { fetchBrands } from '@/lib/brands-client';
import NotificationBell from '@/components/NotificationBell';

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
  const [adminOpen, setAdminOpen] = useState(false);
  const [salesOpen, setSalesOpen] = useState(false);
  const [financialOpen, setFinancialOpen] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(false);
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

  useEffect(() => {
    function handleClick() { setAdminOpen(false); setSalesOpen(false); setFinancialOpen(false); setReportsOpen(false); }
    if (adminOpen || salesOpen || financialOpen || reportsOpen) document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [adminOpen, salesOpen, financialOpen, reportsOpen]);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  return (
    <nav className="bg-white shadow-sm border-b relative z-30">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex justify-between h-14">
          <div className="flex space-x-8 items-center">
            <Link href="/u" className="inline-flex items-center px-1 pt-1 text-sm font-medium text-gray-900 hover:text-blue-600">
              首页
            </Link>
            <Link href="/u/dashboard" className="inline-flex items-center px-1 pt-1 text-sm font-medium text-gray-500 hover:text-blue-600">
              经营看板
            </Link>
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setFinancialOpen(v => !v); }}
                className="inline-flex items-center px-1 pt-1 text-sm font-medium text-gray-500 hover:text-blue-600"
              >
                财务报表 ▼
              </button>
              {financialOpen && (
                <div className="absolute left-0 top-full mt-1 w-36 bg-white border rounded shadow-lg z-50">
                  <Link href="/u/financial" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">财务报表</Link>
                  <Link href="/u/payment" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">付款分析</Link>
                  <Link href="/u/income" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">收入分析</Link>
                </div>
              )}
            </div>
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setSalesOpen((v) => !v); }}
                className="inline-flex items-center px-1 pt-1 text-sm font-medium text-gray-500 hover:text-blue-600"
              >
                销售数据 ▼
              </button>
              {salesOpen && (
                <div className="absolute left-0 top-full mt-1 w-36 bg-white border rounded shadow-lg z-50">
                  <Link href="/u/sales" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">销售总览</Link>
                  <Link href="/u/sales/gelatomiiix" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">蜜可诗销售</Link>
                  <Link href="/u/sales/bonjur" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">旺鼎阁销售</Link>
                  <Link href="/u/sales/tamkoko" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">泰柯销售</Link>
                  <Link href="/u/inventory" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">库存盘点</Link>
                </div>
              )}
            </div>
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setReportsOpen((v) => !v); }}
                className="inline-flex items-center px-1 pt-1 text-sm font-medium text-gray-500 hover:text-blue-600"
              >
                报表 ▼
              </button>
              {reportsOpen && (
                <div className="absolute left-0 top-full mt-1 w-36 bg-white border rounded shadow-lg z-50">
                  <Link href="/u/store-report" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">门店月报</Link>
                </div>
              )}
            </div>

            {me?.role === 'admin' && (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setAdminOpen((v) => !v); }}
                  className="inline-flex items-center px-1 pt-1 text-sm font-medium text-gray-500 hover:text-blue-600"
                >
                  管理 ▼
                </button>
                {adminOpen && (
                  <div className="absolute left-0 top-full mt-1 w-40 bg-white border rounded shadow-lg z-50">
                    <Link href="/admin/pipeline" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">Pipeline 监控</Link>
                    <Link href="/admin/rules" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">规则管理</Link>
                    <Link href="/admin/match" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">人工匹配</Link>
                    <Link href="/u/approvals" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">分类审批</Link>
                    <Link href="/admin/upload" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">文件上传</Link>
                    <Link href="/admin/config" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">配置</Link>
                    <Link href="/admin/users" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">账号管理</Link>
                    <Link href="/u/admin/agent-config" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">Agent 配置</Link>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">品牌:</span>
            <BrandSelector />

            {me && (
              <span className="text-xs text-gray-500">{me.username} ({me.role})</span>
            )}

            <NotificationBell />

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
