'use client';

import { useEffect, useMemo, useState } from 'react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { fetchBrands } from '@/lib/brands-client';

function SortableItem({ id, name }: { id: string; name: string }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} className="flex items-center justify-between border rounded px-3 py-2 bg-white">
      <div className="flex items-center gap-2">
        <span className="cursor-grab select-none text-gray-400" {...attributes} {...listeners}>⋮⋮</span>
        <span className="text-sm">{name}</span>
      </div>
    </div>
  );
}

export default function AdminRuleGroupsPage() {
  const [brand, setBrand] = useState('yufeng');
  const [brands, setBrands] = useState<Array<{ brand_code: string; brand_name: string }>>([]);
  const [groups, setGroups] = useState<Array<{ group_name: string; sort_order: number }>>([]);
  const [newName, setNewName] = useState('');
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
    load();
  }, [brand]);

  async function load() {
    setError(null);
    const res = await fetch(`/api/admin/rule-groups?brand=${brand}`);
    const data = await res.json();
    if (!data.success) {
      setError(data.error || 'Failed');
      return;
    }
    setGroups(data.data || []);
  }

  const ids = useMemo(() => groups.map((g) => g.group_name), [groups]);

  async function create() {
    setError(null);
    const res = await fetch('/api/admin/rule-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand, group_name: newName, sort_order: 9999 }),
    });
    const data = await res.json();
    if (!data.success) {
      setError(data.error || 'Create failed');
      return;
    }
    setNewName('');
    await load();
  }

  async function saveOrder(nextIds: string[]) {
    setSaving(true);
    try {
      await fetch('/api/admin/rule-groups/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, ordered_group_names: nextIds }),
      });
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Admin / Rule Groups</h1>

      <div className="bg-white border rounded p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="text-sm text-gray-600">品牌</div>
          <select className="border rounded px-2 py-1" value={brand} onChange={(e) => setBrand(e.target.value)}>
            {brands.map((b) => (
              <option key={b.brand_code} value={b.brand_code}>{b.brand_name}</option>
            ))}
          </select>
        </div>

        <div className="flex gap-2">
          <input className="border rounded px-2 py-1 flex-1" placeholder="新分组名" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button className="border rounded px-3 py-1" onClick={create}>新增分组</button>
        </div>

        {error && <div className="text-sm text-red-600">{error}</div>}

        <div className="text-xs text-gray-500">拖拽分组排序（保存后会写入 sort_order）。</div>

        <DndContext
          collisionDetection={closestCenter}
          onDragEnd={(e) => {
            const { active, over } = e;
            if (!over) return;
            if (active.id === over.id) return;
            const oldIndex = ids.indexOf(String(active.id));
            const newIndex = ids.indexOf(String(over.id));
            const next = arrayMove(ids, oldIndex, newIndex);
            setGroups(next.map((name, idx) => ({ group_name: String(name), sort_order: idx * 10 })));
            saveOrder(next.map(String));
          }}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {groups.map((g) => (
                <SortableItem key={g.group_name} id={g.group_name} name={g.group_name} />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {saving && <div className="text-xs text-gray-500">保存中...</div>}
      </div>
    </div>
  );
}
