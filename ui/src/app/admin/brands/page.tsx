'use client';

import { useEffect, useState } from 'react';

type BrandRow = {
  brand_code: string;
  brand_name: string;
  schema_prefix: string;
  enabled: boolean;
};

export default function AdminBrandsPage() {
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [brand_code, setCode] = useState('');
  const [brand_name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch('/api/admin/brands');
    const data = await res.json();
    if (!data.success) {
      setError(data.error || 'Failed');
      return;
    }
    setBrands(data.data);
  }

  useEffect(() => {
    load();
  }, []);

  async function create() {
    setError(null);
    const res = await fetch('/api/admin/brands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand_code, brand_name }),
    });
    const data = await res.json();
    if (!data.success) {
      setError(data.error || 'Create failed');
      return;
    }
    setCode('');
    setName('');
    await load();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Admin / Brands</h1>

      <div className="bg-white border rounded p-4 space-y-2">
        <div className="font-medium">创建新品牌</div>
        <div className="flex gap-2">
          <input className="border rounded px-2 py-1" placeholder="brand_code (e.g. huoguo)" value={brand_code} onChange={e => setCode(e.target.value)} />
          <input className="border rounded px-2 py-1 flex-1" placeholder="brand_name" value={brand_name} onChange={e => setName(e.target.value)} />
          <button className="border rounded px-3 py-1" onClick={create}>创建</button>
        </div>
        {error && <div className="text-sm text-red-600">{error}</div>}
        <div className="text-xs text-gray-500">新品牌会创建 schema：brand_&lt;code&gt;_(ods/cfg/dm/ops)，并复制字典表与规则表结构。</div>
      </div>

      <div className="bg-white border rounded p-4">
        <div className="font-medium mb-2">品牌列表</div>
        <div className="text-sm">
          <div className="grid grid-cols-4 gap-2 font-semibold border-b pb-2">
            <div>brand_code</div><div>brand_name</div><div>schema_prefix</div><div>enabled</div>
          </div>
          {brands.map(b => (
            <div key={b.brand_code} className="grid grid-cols-4 gap-2 py-2 border-b">
              <div>{b.brand_code}</div>
              <div>{b.brand_name}</div>
              <div>{b.schema_prefix}</div>
              <div>{String(b.enabled)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
