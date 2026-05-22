'use client';

import { useEffect, useMemo, useState } from 'react';
import { useBrand } from '@/lib/brand-context';

type BrandRow = { brand_code: string; brand_name: string; enabled: boolean; sort_order?: number };

type Lvl1Row = {
  lvl1_code: string;
  lvl1_name: string;
  direction: 'in' | 'out' | 'any';
  enabled: boolean;
  sort_order: number | null;
  updated_at?: string;
};

type Lvl2Row = {
  lvl1_code: string;
  lvl2_code: string;
  lvl2_name: string;
  enabled: boolean;
  sort_order: number | null;
  updated_at?: string;
};

export default function CategoryDictionaryPage() {
  const [tab, setTab] = useState<'lvl1' | 'lvl2' | 'sync'>('lvl1');
  const { brand, setBrand } = useBrand();

  const [lvl1, setLvl1] = useState<Lvl1Row[]>([]);
  const [lvl2, setLvl2] = useState<Lvl2Row[]>([]);

  const [lvl1Loading, setLvl1Loading] = useState(false);
  const [lvl2Loading, setLvl2Loading] = useState(false);

  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);

  // Lvl1 form
  const [lvl1Form, setLvl1Form] = useState({
    lvl1_code: '',
    lvl1_name: '',
    direction: 'any' as 'in' | 'out' | 'any',
    enabled: true,
    sort_order: '' as string,
  });
  const [lvl1Editing, setLvl1Editing] = useState(false);
  const [lvl1Error, setLvl1Error] = useState<string | null>(null);

  // Lvl2 form
  const [lvl2FilterLvl1, setLvl2FilterLvl1] = useState<string>('');
  const [lvl2Form, setLvl2Form] = useState({
    lvl1_code: '',
    lvl2_code: '',
    lvl2_name: '',
    enabled: true,
    sort_order: '' as string,
  });
  const [lvl2Editing, setLvl2Editing] = useState(false);
  const [lvl2Error, setLvl2Error] = useState<string | null>(null);

  // Copy helper
  const [copyLoading, setCopyLoading] = useState(false);

  // Sync
  const [syncMode, setSyncMode] = useState<'safe' | 'force'>('safe');
  const [syncPreview, setSyncPreview] = useState<any[] | null>(null);
  const [syncResult, setSyncResult] = useState<any[] | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  async function loadLvl1() {
    setLvl1Loading(true);
    try {
      const res = await fetch(`/api/admin/brand-category-dictionary/lvl1?brand=${encodeURIComponent(brand)}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed');
      setLvl1(data.data || []);
    } finally {
      setLvl1Loading(false);
    }
  }

  async function loadLvl2() {
    setLvl2Loading(true);
    try {
      const url = lvl2FilterLvl1
        ? `/api/admin/brand-category-dictionary/lvl2?brand=${encodeURIComponent(brand)}&lvl1_code=${encodeURIComponent(lvl2FilterLvl1)}`
        : `/api/admin/brand-category-dictionary/lvl2?brand=${encodeURIComponent(brand)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed');
      setLvl2(data.data || []);
    } finally {
      setLvl2Loading(false);
    }
  }

  async function loadBrands() {
    const res = await fetch('/api/admin/brands');
    const data = await res.json();
    if (data?.success) {
      const b = (data.data || []) as BrandRow[];
      const enabled = b.filter((x) => x.enabled);
      setBrands(enabled);
      setSelectedBrands(enabled.map((x) => x.brand_code));
      // 当前页面的品牌由顶栏 BrandSelector 驱动；这里不强制改动用户当前选择
    }
  }

  useEffect(() => {
    loadBrands();
  }, []);

  useEffect(() => {
    if (!brand) return;
    loadLvl1();
    loadLvl2();
  }, [brand]);

  useEffect(() => {
    // keep lvl2 filter consistent if lvl1 list changes
    if (lvl2FilterLvl1 && !lvl1.some((x) => x.lvl1_code === lvl2FilterLvl1)) {
      setLvl2FilterLvl1('');
    }
  }, [lvl1, lvl2FilterLvl1]);

  const lvl1Codes = useMemo(() => lvl1.map((x) => x.lvl1_code), [lvl1]);

  function resetLvl1Form() {
    setLvl1Form({ lvl1_code: '', lvl1_name: '', direction: 'any', enabled: true, sort_order: '' });
    setLvl1Editing(false);
    setLvl1Error(null);
  }

  function resetLvl2Form() {
    setLvl2Form({ lvl1_code: '', lvl2_code: '', lvl2_name: '', enabled: true, sort_order: '' });
    setLvl2Editing(false);
    setLvl2Error(null);
  }

  async function saveLvl1() {
    setLvl1Error(null);
    const payload: any = {
      brand,
      lvl1_code: lvl1Form.lvl1_code,
      lvl1_name: lvl1Form.lvl1_name,
      direction: lvl1Form.direction,
      enabled: lvl1Form.enabled,
      sort_order: lvl1Form.sort_order === '' ? null : Number(lvl1Form.sort_order),
    };

    const res = await fetch('/api/admin/brand-category-dictionary/lvl1', {
      method: lvl1Editing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.success) {
      setLvl1Error(data.error || 'Save failed');
      return;
    }
    await loadLvl1();
    resetLvl1Form();
  }

  async function saveLvl2() {
    setLvl2Error(null);
    const payload: any = {
      brand,
      lvl1_code: lvl2Form.lvl1_code,
      lvl2_code: lvl2Form.lvl2_code,
      lvl2_name: lvl2Form.lvl2_name,
      enabled: lvl2Form.enabled,
      sort_order: lvl2Form.sort_order === '' ? null : Number(lvl2Form.sort_order),
    };

    const res = await fetch('/api/admin/brand-category-dictionary/lvl2', {
      method: lvl2Editing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.success) {
      setLvl2Error(data.error || 'Save failed');
      return;
    }
    await loadLvl2();
    resetLvl2Form();
  }

  async function doPreview() {
    setSyncError(null);
    setSyncPreview(null);
    setSyncResult(null);
    setPreviewLoading(true);
    try {
      const res = await fetch('/api/admin/category-dictionary/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brands: selectedBrands }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Preview failed');
      setSyncPreview(data.data || []);
    } catch (e: any) {
      setSyncError(e.message);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function doSync() {
    setSyncError(null);
    setSyncResult(null);
    setSyncLoading(true);
    try {
      const res = await fetch('/api/admin/category-dictionary/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brands: selectedBrands, mode: syncMode }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Sync failed');
      setSyncResult(data.data || []);
    } catch (e: any) {
      setSyncError(e.message);
    } finally {
      setSyncLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Admin / 配置 / 字典管理</h1>
          <div className="text-xs text-gray-500">
            按品牌独立管理（写入 {brand}_cfg.dim_category_lvl1/lvl2）。品牌切换请用顶部导航栏的「品牌」下拉。
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="px-3 py-1 border rounded disabled:opacity-50"
            disabled={copyLoading}
            onClick={async () => {
              setSyncError(null);
              setCopyLoading(true);
              try {
                const res = await fetch('/api/admin/brand-category-dictionary/copy-from-yufeng', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ brand, mode: 'overwrite' }),
                });
                const data = await res.json();
                if (!data.success) {
                  const extra = data.code ? ` (${data.code})` : '';
                  throw new Error((data.error || 'Copy failed') + extra);
                }
                await loadLvl1();
                await loadLvl2();
                alert(`已从 yufeng 复制到 ${brand}：lvl1 ${data.data?.lvl1_upsert ?? 0}, lvl2 ${data.data?.lvl2_upsert ?? 0}`);
              } catch (e: any) {
                setSyncError(e.message);
                alert(`复制失败：${e.message}`);
              } finally {
                setCopyLoading(false);
              }
            }}
          >
            {copyLoading ? '复制中...' : '从 yufeng 复制到当前品牌'}
          </button>
        </div>
      </div>

      {syncError && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
          {syncError}
        </div>
      )}

      <div className="flex gap-2">
        <button className={`px-3 py-1 border rounded ${tab === 'lvl1' ? 'bg-gray-100' : 'bg-white'}`} onClick={() => setTab('lvl1')}>默认一级</button>
        <button className={`px-3 py-1 border rounded ${tab === 'lvl2' ? 'bg-gray-100' : 'bg-white'}`} onClick={() => setTab('lvl2')}>默认二级</button>
        <button className={`px-3 py-1 border rounded ${tab === 'sync' ? 'bg-gray-100' : 'bg-white'}`} onClick={() => setTab('sync')}>同步</button>
      </div>

      {tab === 'lvl1' && (
        <div className="bg-white border rounded p-4 space-y-3">
          <div className="font-medium">默认一级分类</div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
            <div>
              <div className="text-xs text-gray-500">lvl1_code</div>
              <input
                className="border rounded px-2 py-1 w-full"
                placeholder="例如: FOOD"
                value={lvl1Form.lvl1_code}
                onChange={(e) => setLvl1Form({ ...lvl1Form, lvl1_code: e.target.value.toUpperCase() })}
                disabled={lvl1Editing}
              />
            </div>
            <div className="md:col-span-2">
              <div className="text-xs text-gray-500">lvl1_name</div>
              <input
                className="border rounded px-2 py-1 w-full"
                placeholder="名称"
                value={lvl1Form.lvl1_name}
                onChange={(e) => setLvl1Form({ ...lvl1Form, lvl1_name: e.target.value })}
              />
            </div>
            <div>
              <div className="text-xs text-gray-500">direction</div>
              <select className="border rounded px-2 py-1 w-full" value={lvl1Form.direction} onChange={(e) => setLvl1Form({ ...lvl1Form, direction: e.target.value as any })}>
                <option value="any">任意</option>
                <option value="in">收入</option>
                <option value="out">支出</option>
              </select>
            </div>
            <div>
              <div className="text-xs text-gray-500">sort_order</div>
              <input className="border rounded px-2 py-1 w-full" placeholder="10" value={lvl1Form.sort_order} onChange={(e) => setLvl1Form({ ...lvl1Form, sort_order: e.target.value })} />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <label className="text-sm flex items-center gap-2">
              <input type="checkbox" checked={lvl1Form.enabled} onChange={(e) => setLvl1Form({ ...lvl1Form, enabled: e.target.checked })} />
              启用
            </label>
            <div className="flex gap-2">
              {lvl1Editing && (
                <button className="px-3 py-1 border rounded" onClick={resetLvl1Form}>取消编辑</button>
              )}
              <button className="px-3 py-1 border rounded bg-blue-600 text-white" onClick={saveLvl1}>保存</button>
            </div>
          </div>
          {lvl1Error && <div className="text-sm text-red-600">{lvl1Error}</div>}
          <div className="text-xs text-gray-500">删除建议用“禁用 enabled=false”（可同步到各品牌）。</div>

          <div className="border-t pt-3">
            {lvl1Loading ? (
              <div className="text-sm text-gray-500">加载中...</div>
            ) : (
              <div className="space-y-1">
                {lvl1.map((r) => (
                  <div key={r.lvl1_code} className="grid grid-cols-6 gap-2 py-1 border-b text-sm items-center">
                    <div className="font-mono">{r.lvl1_code}</div>
                    <div className="col-span-2">{r.lvl1_name}</div>
                    <div className="text-gray-500">{r.direction}</div>
                    <div className="text-gray-500">order: {r.sort_order ?? 999999}</div>
                    <div className="flex justify-end gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${r.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{r.enabled ? 'enabled' : 'disabled'}</span>
                      <button
                        className="text-blue-600"
                        onClick={() => {
                          setLvl1Editing(true);
                          setLvl1Form({
                            lvl1_code: r.lvl1_code,
                            lvl1_name: r.lvl1_name,
                            direction: r.direction,
                            enabled: r.enabled,
                            sort_order: r.sort_order === null || r.sort_order === undefined ? '' : String(r.sort_order),
                          });
                        }}
                      >
                        编辑
                      </button>
                    </div>
                  </div>
                ))}
                {lvl1.length === 0 && <div className="text-sm text-gray-400">暂无数据（你可以先复制 yufeng 的默认字典到这里）。</div>}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'lvl2' && (
        <div className="bg-white border rounded p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-medium">默认二级分类</div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-500">筛选 lvl1</span>
              <select className="border rounded px-2 py-1" value={lvl2FilterLvl1} onChange={(e) => { setLvl2FilterLvl1(e.target.value); }}>
                <option value="">全部</option>
                {lvl1Codes.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <button className="px-3 py-1 border rounded" onClick={loadLvl2}>刷新</button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
            <div>
              <div className="text-xs text-gray-500">lvl1_code</div>
              <select className="border rounded px-2 py-1 w-full" value={lvl2Form.lvl1_code} onChange={(e) => setLvl2Form({ ...lvl2Form, lvl1_code: e.target.value })} disabled={lvl2Editing}>
                <option value="">请选择</option>
                {lvl1Codes.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <div className="text-xs text-gray-500">lvl2_code</div>
              <input
                className="border rounded px-2 py-1 w-full"
                placeholder="例如: RENT"
                value={lvl2Form.lvl2_code}
                onChange={(e) => setLvl2Form({ ...lvl2Form, lvl2_code: e.target.value.toUpperCase() })}
                disabled={lvl2Editing}
              />
            </div>
            <div className="md:col-span-2">
              <div className="text-xs text-gray-500">lvl2_name</div>
              <input
                className="border rounded px-2 py-1 w-full"
                placeholder="名称"
                value={lvl2Form.lvl2_name}
                onChange={(e) => setLvl2Form({ ...lvl2Form, lvl2_name: e.target.value })}
              />
            </div>
            <div>
              <div className="text-xs text-gray-500">sort_order</div>
              <input className="border rounded px-2 py-1 w-full" placeholder="10" value={lvl2Form.sort_order} onChange={(e) => setLvl2Form({ ...lvl2Form, sort_order: e.target.value })} />
            </div>
            <div className="flex gap-2">
              {lvl2Editing && (
                <button className="px-3 py-1 border rounded" onClick={resetLvl2Form}>取消</button>
              )}
              <button className="px-3 py-1 border rounded bg-blue-600 text-white" onClick={saveLvl2}>保存</button>
            </div>
          </div>
          <label className="text-sm flex items-center gap-2">
            <input type="checkbox" checked={lvl2Form.enabled} onChange={(e) => setLvl2Form({ ...lvl2Form, enabled: e.target.checked })} />
            启用
          </label>
          {lvl2Error && <div className="text-sm text-red-600">{lvl2Error}</div>}

          <div className="border-t pt-3">
            {lvl2Loading ? (
              <div className="text-sm text-gray-500">加载中...</div>
            ) : (
              <div className="space-y-1">
                {lvl2.map((r) => (
                  <div key={`${r.lvl1_code}:${r.lvl2_code}`} className="grid grid-cols-7 gap-2 py-1 border-b text-sm items-center">
                    <div className="font-mono">{r.lvl1_code}</div>
                    <div className="font-mono">{r.lvl2_code}</div>
                    <div className="col-span-2">{r.lvl2_name}</div>
                    <div className="text-gray-500">order: {r.sort_order ?? 999999}</div>
                    <div className="flex justify-end">
                      <span className={`text-xs px-2 py-0.5 rounded ${r.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{r.enabled ? 'enabled' : 'disabled'}</span>
                    </div>
                    <div className="flex justify-end">
                      <button
                        className="text-blue-600"
                        onClick={() => {
                          setLvl2Editing(true);
                          setLvl2Form({
                            lvl1_code: r.lvl1_code,
                            lvl2_code: r.lvl2_code,
                            lvl2_name: r.lvl2_name,
                            enabled: r.enabled,
                            sort_order: r.sort_order === null || r.sort_order === undefined ? '' : String(r.sort_order),
                          });
                        }}
                      >
                        编辑
                      </button>
                    </div>
                  </div>
                ))}
                {lvl2.length === 0 && <div className="text-sm text-gray-400">暂无数据</div>}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'sync' && (
        <div className="bg-white border rounded p-4 space-y-3">
          <div className="font-medium">同步默认字典 → 品牌字典</div>

          <div className="flex flex-wrap gap-2">
            <button
              className="px-3 py-1 border rounded"
              onClick={async () => {
                setSyncError(null);
                try {
                  const res = await fetch('/api/admin/brand-category-dictionary/copy-from-yufeng', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ brand, mode: 'overwrite' }),
                  });
                  const data = await res.json();
                  if (!data.success) throw new Error(data.error || 'Copy failed');
                  await loadLvl1();
                  await loadLvl2();
                  alert(`已从 yufeng 复制到 ${brand}：lvl1 ${data.data?.lvl1_upsert ?? 0}, lvl2 ${data.data?.lvl2_upsert ?? 0}`);
                } catch (e: any) {
                  setSyncError(e.message);
                }
              }}
            >
              从 yufeng 复制到当前品牌（待接）
            </button>
            <div className="text-xs text-gray-500 flex items-center">
              计划支持“一键从 yufeng 拷贝到当前品牌”（用于 brand 初始化）。
            </div>
          </div>

          <div className="text-sm text-gray-600">
            - safe：只补齐缺失项（不覆盖品牌已有的条目）<br />
            - force：全量覆盖（默认字典为准，包含 enabled/sort_order 等）
          </div>

          <div className="flex items-center gap-3">
            <div className="text-sm text-gray-500">模式</div>
            <select className="border rounded px-2 py-1" value={syncMode} onChange={(e) => setSyncMode(e.target.value as any)}>
              <option value="safe">safe（不覆盖）</option>
              <option value="force">force（覆盖）</option>
            </select>
          </div>

          <div>
            <div className="text-sm text-gray-500 mb-2">目标品牌（默认全选启用品牌）</div>
            <div className="flex flex-wrap gap-2">
              <button
                className="px-2 py-1 border rounded text-sm"
                onClick={() => setSelectedBrands(brands.map((b) => b.brand_code))}
              >
                全选
              </button>
              <button
                className="px-2 py-1 border rounded text-sm"
                onClick={() => setSelectedBrands([])}
              >
                全不选
              </button>
            </div>
            <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2">
              {brands.map((b) => (
                <label key={b.brand_code} className="text-sm flex items-center gap-2 border rounded px-2 py-1">
                  <input
                    type="checkbox"
                    checked={selectedBrands.includes(b.brand_code)}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setSelectedBrands((prev) => checked ? [...prev, b.brand_code] : prev.filter((x) => x !== b.brand_code));
                    }}
                  />
                  <span>{b.brand_name}</span>
                  <span className="text-xs text-gray-400">({b.brand_code})</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button className="px-3 py-1 border rounded" onClick={doPreview} disabled={previewLoading}>
              {previewLoading ? '预览中...' : '预览差异'}
            </button>
            <button className="px-3 py-1 border rounded bg-orange-600 text-white" onClick={doSync} disabled={syncLoading}>
              {syncLoading ? '同步中...' : '执行同步'}
            </button>
          </div>

          {syncError && <div className="text-sm text-red-600">{syncError}</div>}

          {syncPreview && (
            <div className="border rounded p-3 bg-gray-50 text-sm">
              <div className="font-medium mb-2">预览（缺失 / 差异）</div>
              <div className="space-y-1">
                {syncPreview.map((r: any) => (
                  <div key={r.brand} className="flex justify-between">
                    <span className="font-mono">{r.brand}</span>
                    <span>
                      lvl1 missing {r.lvl1_missing}, diff {r.lvl1_diff}；lvl2 missing {r.lvl2_missing}, diff {r.lvl2_diff}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {syncResult && (
            <div className="border rounded p-3 bg-gray-50 text-sm">
              <div className="font-medium mb-2">同步结果</div>
              <div className="space-y-1">
                {syncResult.map((r: any) => (
                  <div key={r.brand} className="flex justify-between">
                    <span className="font-mono">{r.brand}</span>
                    {r.ok ? (
                      <span>ok · lvl1_upsert {r.lvl1_upsert} · lvl2_upsert {r.lvl2_upsert} · mode {r.mode}</span>
                    ) : (
                      <span className="text-red-600">failed · {r.error}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="text-xs text-gray-500">
            注意：建议默认字典里用“禁用 enabled=false”替代物理删除，这样同步可把禁用状态传播到所有品牌。
          </div>
        </div>
      )}
    </div>
  );
}
