'use client';

import { useEffect, useState } from 'react';
import { fetchBrands } from '@/lib/brands-client';

export default function AdminRulesCopyPage() {
  const [brands, setBrands] = useState<Array<{ brand_code: string; brand_name: string }>>([]);
  const [from_brand, setFrom] = useState('yufeng');
  const [to_brand, setTo] = useState('bonjur');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchBrands().then((b) => {
      if (b.length) {
        setBrands(b);
        setFrom(b[0].brand_code);
        setTo(b.length > 1 ? b[1].brand_code : b[0].brand_code);
      }
    });
  }, []);

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/admin/rules-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_brand, to_brand, mode: 'overwrite' }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Failed');
        return;
      }
      setResult(data.data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Admin / Rules Copy（S2 覆盖模式）</h1>

      <div className="bg-white border rounded p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <div className="text-sm text-gray-600">From brand</div>
            <select className="border rounded px-2 py-1 w-full" value={from_brand} onChange={(e) => setFrom(e.target.value)}>
              {brands.map((b) => <option key={b.brand_code} value={b.brand_code}>{b.brand_name}</option>)}
            </select>
          </div>
          <div>
            <div className="text-sm text-gray-600">To brand</div>
            <select className="border rounded px-2 py-1 w-full" value={to_brand} onChange={(e) => setTo(e.target.value)}>
              {brands.map((b) => <option key={b.brand_code} value={b.brand_code}>{b.brand_name}</option>)}
            </select>
          </div>
        </div>

        <button className="border rounded px-3 py-1" disabled={loading} onClick={run}>
          {loading ? '复制中...' : '复制规则（覆盖）'}
        </button>

        <div className="text-xs text-gray-500">
          S2：若目标品牌存在相同匹配 key（field/type/value/direction/field2/value2），则覆盖更新；否则插入新规则。
        </div>

        {error && <div className="text-sm text-red-600">{error}</div>}
        {result && (
          <pre className="text-xs bg-gray-50 border rounded p-2 overflow-auto">{JSON.stringify(result, null, 2)}</pre>
        )}
      </div>
    </div>
  );
}
