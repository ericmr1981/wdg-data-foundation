'use client';

import { useEffect, useState } from 'react';
import { fetchBrands } from '@/lib/brands-client';

type StoreRow = {
  brand_code: string;
  store_code: string;
  store_name: string;
  enabled: boolean;
};

export default function AdminStoresPage() {
  const [brand, setBrand] = useState('yufeng');
  const [brands, setBrands] = useState<Array<{ brand_code: string; brand_name: string }>>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);

  const [store_code, setCode] = useState('');
  const [store_name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchBrands().then((b) => {
      if (b.length) {
        setBrands(b);
        setBrand(b[0].brand_code);
      }
    });
  }, []);

  useEffect(() => {
    if (brand) load();
  }, [brand]);

  async function load() {
    setError(null);
    const res = await fetch(`/api/admin/stores?brand=${brand}`);
    const data = await res.json();
    if (!data.success) {
      setError(data.error || 'Failed');
      return;
    }
    setStores(data.data);
  }

  async function create() {
    setError(null);
    const res = await fetch('/api/admin/stores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand, store_code, store_name }),
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
      <h1 className="text-xl font-semibold">Admin / Stores</h1>

      <div className="bg-white border rounded p-4 space-y-2">
        <div className="flex items-center gap-2">
          <div className="text-sm text-gray-600">品牌</div>
          <select className="border rounded px-2 py-1" value={brand} onChange={(e) => setBrand(e.target.value)}>
            {brands.map((b) => (
              <option key={b.brand_code} value={b.brand_code}>{b.brand_name}</option>
            ))}
          </select>
        </div>

        <div className="font-medium">新增门店</div>
        <div className="flex gap-2">
          <input className="border rounded px-2 py-1" placeholder="store_code (e.g. sh_pudong)" value={store_code} onChange={e => setCode(e.target.value)} />
          <input className="border rounded px-2 py-1 flex-1" placeholder="store_name" value={store_name} onChange={e => setName(e.target.value)} />
          <button className="border rounded px-3 py-1" onClick={create}>创建</button>
        </div>
        {error && <div className="text-sm text-red-600">{error}</div>}
      </div>

      <div className="bg-white border rounded p-4">
        <div className="font-medium mb-2">门店列表</div>
        <div className="text-sm">
          <div className="grid grid-cols-4 gap-2 font-semibold border-b pb-2">
            <div>brand</div><div>store_code</div><div>store_name</div><div>enabled</div>
          </div>
          {stores.map((s) => (
            <div key={s.store_code} className="grid grid-cols-4 gap-2 py-2 border-b">
              <div>{s.brand_code}</div>
              <div>{s.store_code}</div>
              <div>{s.store_name}</div>
              <div>{String(s.enabled)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
