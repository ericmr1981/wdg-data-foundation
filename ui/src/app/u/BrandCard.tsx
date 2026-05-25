'use client';

import { useState } from 'react';

export function BrandCard({
  brand,
  children,
}: {
  brand: { brand_code: string; brand_name: string; file_count: number; latest_import: string | null };
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-white border rounded-lg">
      <button
        className="w-full flex items-center justify-between p-5 text-left hover:bg-gray-50 transition"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold">{brand.brand_name}</span>
          <span className="text-sm text-gray-500">已导入 {brand.file_count} 个文件</span>
          {brand.latest_import && (
            <span className="text-sm text-gray-400">
              最近: {new Date(brand.latest_import).toLocaleString('zh-CN')}
            </span>
          )}
        </div>
        <span className="text-gray-400 text-lg">{open ? '▼' : '▶'}</span>
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}