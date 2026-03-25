'use client';

import { useEffect, useMemo, useState } from 'react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { fetchBrands } from '@/lib/brands-client';

type StoreRow = {
  brand_code: string;
  store_code: string;
  store_name: string;
  enabled: boolean;
  sort_order?: number;
};

function SortableItem({ id, store }: { id: string; store: StoreRow }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} className="grid grid-cols-5 gap-2 py-2 border-b items-center">
      <div className="flex items-center gap-2">
        <span className="cursor-grab select-none text-gray-400" {...attributes} {...listeners}>⋮⋮</span>
        <span>{store.store_code}</span>
      </div>
      <div>{store.store_name}</div>
      <div>{store.brand_code}</div>
      <div>{String(store.enabled)}</div>
      <div className="text-xs text-gray-500">order: {store.sort_order ?? 9999}</div>
    </div>
  );
}

export default function AdminStoresPage() {
  const [brand, setBrand] = useState('yufeng');
  const [brands, setBrands] = useState<Array<{ brand_code: string; brand_name: string }>>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);

  const [store_code, setCode] = useState('');
  const [store_name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
    setStores(data.data || []);
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

  const ids = useMemo(() => stores.map((s) => s.store_code), [stores]);

  async function saveOrder(nextIds: string[]) {
    setSaving(true);
    try {
      await fetch('/api/admin/stores/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, ordered_store_codes: nextIds }),
      });
      await load();
    } finally {
      setSaving(false);
    }
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
        <div className="font-medium mb-2">门店列表（拖拽排序）</div>
        <div className="text-xs text-gray-500 mb-2">拖拽行来调整顺序，松开自动保存。</div>
        <div className="grid grid-cols-5 gap-2 font-semibold border-b pb-2 text-sm">
          <div>store_code</div><div>store_name</div><div>brand</div><div>enabled</div><div>sort_order</div>
        </div>
        <DndContext
          collisionDetection={closestCenter}
          onDragEnd={(e) => {
            const { active, over } = e;
            if (!over) return;
            if (active.id === over.id) return;
            const oldIndex = ids.indexOf(String(active.id));
            const newIndex = ids.indexOf(String(over.id));
            const next = arrayMove(ids, oldIndex, newIndex);
            setStores(next.map((code) => stores.find((s) => s.store_code === code)!));
            saveOrder(next.map(String));
          }}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <div>
              {stores.map((s) => (
                <SortableItem key={s.store_code} id={s.store_code} store={s} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
        {saving && <div className="text-xs text-gray-500 mt-2">保存中...</div>}
      </div>
    </div>
  );
}
