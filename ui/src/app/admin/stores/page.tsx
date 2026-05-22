'use client';

import { useEffect, useMemo, useState } from 'react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useBrand } from '@/lib/brand-context';

type StoreRow = {
  brand_code: string;
  store_code: string;
  store_name: string;
  enabled: boolean;
  sort_order?: number;
};

type SyncChanges = {
  adds: [string, string][];
  removes: [string, string][];
  current: [string, string][];
  target: [string, string][];
};

type DashboardSyncItem = {
  dashboard_id: number;
  dashboard_name: string;
  skipped?: boolean;
  reason?: string;
  changes?: SyncChanges;
};

type SyncResult = {
  success: boolean;
  dry_run: boolean;
  brand: string;
  dashboards: DashboardSyncItem[];
  applied?: boolean;
  applied_dashboards?: any[];
  log_file?: string;
  error?: string;
  message?: string;
};

// ── Sortable row ──────────────────────────────────────────────────────────────
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

// ── Confirmation modal ───────────────────────────────────────────────────────
function ConfirmModal({
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = '确认',
  danger = false,
}: {
  title: string;
  message: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  danger?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
        <h2 className="text-lg font-semibold mb-2">{title}</h2>
        <div className="text-sm text-gray-600 mb-4 space-y-1">{message}</div>
        <div className="flex justify-end gap-2">
          <button
            className="px-4 py-1.5 border rounded text-sm"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            className={`px-4 py-1.5 border rounded text-sm text-white ${danger ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-600 hover:bg-blue-700'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sync preview panel ────────────────────────────────────────────────────────
function SyncPreview({ result, onClose }: { result: SyncResult; onClose: () => void }) {
  const dashboards = result.dashboards || [];
  const active = dashboards.filter((d) => !d.skipped && d.changes);
  const totalAdds = active.reduce((sum, d) => sum + (d.changes?.adds.length || 0), 0);
  const totalRemoves = active.reduce((sum, d) => sum + (d.changes?.removes.length || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-12">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-3xl w-full mx-4 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Metabase 同步预览</h2>
          <button className="text-gray-400 hover:text-gray-600 text-xl" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="text-sm text-gray-600 mb-4">
          品牌：<span className="font-mono text-gray-800">{result.brand}</span>
          <span className="text-gray-400">（将同步 {active.length} 个看板；跳过 {dashboards.length - active.length} 个）</span>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-4 text-sm">
          <div className="bg-green-50 border border-green-200 rounded p-3">
            <div className="font-semibold text-green-700">新增门店（合计）</div>
            <div className="text-2xl font-bold text-green-800">{totalAdds}</div>
          </div>
          <div className="bg-red-50 border border-red-200 rounded p-3">
            <div className="font-semibold text-red-700">删除门店（合计）</div>
            <div className="text-2xl font-bold text-red-800">{totalRemoves}</div>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded p-3">
            <div className="font-semibold text-blue-700">目标门店数</div>
            <div className="text-2xl font-bold text-blue-800">{active[0]?.changes?.target.length ?? 0}</div>
            <div className="text-gray-400 text-xs mt-1">来自 ops.stores</div>
          </div>
        </div>

        <div className="space-y-2">
          {dashboards.map((d) => {
            const adds = d.changes?.adds.length || 0;
            const removes = d.changes?.removes.length || 0;
            return (
              <div key={d.dashboard_id} className="border rounded p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div className="font-medium">
                    {d.dashboard_name}{' '}
                    <a
                      href={`${process.env.NEXT_PUBLIC_METABASE_URL || 'http://127.0.0.1:8082'}/dashboard/${d.dashboard_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 underline font-mono text-xs"
                    >
                      #{d.dashboard_id}
                    </a>
                  </div>
                  {d.skipped ? (
                    <span className="text-xs text-gray-400">跳过：{d.reason || 'unknown'}</span>
                  ) : (
                    <span className="text-xs text-gray-500">新增 {adds} / 删除 {removes}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {totalAdds === 0 && totalRemoves === 0 && (
          <div className="text-center py-4 text-gray-500 text-sm">下拉列表已是最新，无需同步。</div>
        )}

        <div className="flex justify-end mt-4">
          <button className="px-4 py-1.5 border rounded text-sm" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AdminStoresPage() {
  const { brand } = useBrand();
  const [stores, setStores] = useState<StoreRow[]>([]);

  const [store_code, setCode] = useState('');
  const [store_name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showApplyConfirm, setShowApplyConfirm] = useState(false);

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

  // ── Metabase sync ─────────────────────────────────────────────────────────
  async function runSync(dryRun: boolean) {
    setSyncing(true);
    setSyncError(null);
    try {
      const url = `/api/admin/metabase/sync-store-dropdown?brand=${brand}&dry_run=${dryRun}`;
      const res = await fetch(url, { method: 'POST' });
      const data: SyncResult = await res.json();
      if (!data.success) {
        setSyncError(data.error || 'Sync failed');
        return;
      }
      setSyncResult(data);
      if (dryRun) {
        setShowPreview(true);
      }
    } catch (e: any) {
      setSyncError(e.message || 'Network error');
    } finally {
      setSyncing(false);
    }
  }

  async function handleApply() {
    setShowApplyConfirm(false);
    await runSync(false);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Admin / Stores</h1>

      {/* ── New store form ── */}
      <div className="bg-white border rounded p-4 space-y-2">
        <div className="text-xs text-gray-500">当前品牌：{brand}（切换请用顶部导航栏的"品牌"下拉）</div>

        <div className="font-medium">新增门店</div>
        <div className="flex gap-2">
          <input className="border rounded px-2 py-1" placeholder="store_code (e.g. sh_pudong)" value={store_code} onChange={e => setCode(e.target.value)} />
          <input className="border rounded px-2 py-1 flex-1" placeholder="store_name" value={store_name} onChange={e => setName(e.target.value)} />
          <button className="border rounded px-3 py-1" onClick={create}>创建</button>
        </div>
        {error && <div className="text-sm text-red-600">{error}</div>}
      </div>

      {/* ── Metabase store-dropdown sync ── */}
      <div className="bg-white border rounded p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">同步门店到 Metabase 下拉</div>
            <div className="text-xs text-gray-500 mt-0.5">
              将 <span className="font-mono text-gray-700">ops.stores</span> 当前门店集合同步为 Metabase 看板{' '}
              <span className="font-mono text-gray-700">store_code</span> 下拉选项。
              不新增看板，不复制看板。
            </div>
          </div>
          <button
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white border border-blue-700 rounded text-sm disabled:opacity-50"
            onClick={() => runSync(true)}
            disabled={syncing || !brand}
          >
            {syncing ? '同步中…' : '同步门店下拉'}
          </button>
        </div>

        {syncError && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
            错误：{syncError}
          </div>
        )}

        {syncResult && !syncResult.dry_run && syncResult.success && (
          <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded p-2">
            ✅ 同步完成！已对 {syncResult.dashboards.filter((d) => !d.skipped).length} 个看板写入门店下拉。
            {syncResult.log_file && <span className="text-gray-400"> 日志：{syncResult.log_file}</span>}
          </div>
        )}

        {syncResult && syncResult.dry_run && syncResult.success && (
          <div className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded p-2">
            预览就绪：将同步 {syncResult.dashboards.filter((d) => !d.skipped).length} 个看板。
          </div>
        )}
      </div>

      {/* ── Store list (drag-to-reorder) ── */}
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
        {saving && <div className="text-xs text-gray-500 mt-2">保存中…</div>}
      </div>

      {/* ── Modals ── */}
      {showPreview && syncResult && (
        <SyncPreview
          result={syncResult}
          onClose={() => {
            setShowPreview(false);
            // Offer apply
            const active = syncResult.dashboards.filter((d) => !d.skipped && d.changes);
            const adds = active.reduce((s, d) => s + (d.changes?.adds.length || 0), 0);
            const removes = active.reduce((s, d) => s + (d.changes?.removes.length || 0), 0);
            if (adds > 0 || removes > 0) setShowApplyConfirm(true);
          }}
        />
      )}

      {showApplyConfirm && syncResult && (
        <ConfirmModal
          title="确认同步到 Metabase？"
          message={
            <>
              {(() => {
                const active = syncResult.dashboards.filter((d) => !d.skipped && d.changes);
                const adds = active.reduce((s, d) => s + (d.changes?.adds.length || 0), 0);
                const removes = active.reduce((s, d) => s + (d.changes?.removes.length || 0), 0);
                return (
                  <>
                    <p>即将对 {active.length} 个看板执行以下更改（合计）：</p>
                    <ul className="list-disc list-inside mt-1">
                      <li>新增 {adds} 个门店到下拉</li>
                      <li>删除 {removes} 个门店从下拉</li>
                    </ul>
                  </>
                );
              })()}
              <p className="mt-1 text-gray-400 text-xs">此操作直接写入 Metabase，不可撤销。建议先确认 dry-run 预览。</p>
            </>
          }
          onConfirm={handleApply}
          onCancel={() => setShowApplyConfirm(false)}
          confirmLabel="确认同步"
          danger
        />
      )}
    </div>
  );
}
