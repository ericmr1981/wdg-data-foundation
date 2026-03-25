'use client';

import { useEffect, useMemo, useState } from 'react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type BrandRow = {
  brand_code: string;
  brand_name: string;
  schema_prefix: string;
  enabled: boolean;
  sort_order?: number;
};

function SortableItem({ id, brand }: { id: string; brand: BrandRow }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} className="grid grid-cols-5 gap-2 py-2 border-b items-center">
      <div className="flex items-center gap-2">
        <span className="cursor-grab select-none text-gray-400" {...attributes} {...listeners}>⋮⋮</span>
        <span>{brand.brand_code}</span>
      </div>
      <div>{brand.brand_name}</div>
      <div>{brand.schema_prefix}</div>
      <div>{String(brand.enabled)}</div>
      <div className="text-xs text-gray-500">order: {brand.sort_order ?? 9999}</div>
    </div>
  );
}

export default function AdminBrandsPage() {
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [brand_code, setCode] = useState('');
  const [brand_name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await fetch('/api/admin/brands');
    const data = await res.json();
    if (!data.success) {
      setError(data.error || 'Failed');
      return;
    }
    setBrands(data.data || []);
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

  const ids = useMemo(() => brands.map((b) => b.brand_code), [brands]);

  async function saveOrder(nextIds: string[]) {
    setSaving(true);
    try {
      await fetch('/api/admin/brands/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ordered_brand_codes: nextIds }),
      });
      await load();
    } finally {
      setSaving(false);
    }
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
        <div className="font-medium mb-2">品牌列表（拖拽排序）</div>
        <div className="text-xs text-gray-500 mb-2">拖拽行来调整顺序，松开自动保存。</div>
        <div className="grid grid-cols-5 gap-2 font-semibold border-b pb-2 text-sm">
          <div>brand_code</div><div>brand_name</div><div>schema_prefix</div><div>enabled</div><div>sort_order</div>
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
            setBrands(next.map((code) => brands.find((b) => b.brand_code === code)!));
            saveOrder(next.map(String));
          }}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <div>
              {brands.map((b) => (
                <SortableItem key={b.brand_code} id={b.brand_code} brand={b} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
        {saving && <div className="text-xs text-gray-500 mt-2">保存中...</div>}
      </div>
    </div>
  );
}
