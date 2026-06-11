'use client';

import { useEffect, useState, useMemo, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useBrand } from '@/lib/brand-context';
import ApprovalRow from './components/ApprovalRow';
import BatchToolbar from './components/BatchToolbar';
import type { ProposalRow } from './components/types';

type FilterTab = 'all' | 'type1' | 'type2' | 'pending';

function ApprovalsContent() {
  const { brand, setBrand } = useBrand();
  const searchParams = useSearchParams();
  const source = searchParams.get('source');
  const brandParam = searchParams.get('brand');
  const filterParam = searchParams.get('filter');

  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(() => searchParams.get('batch') ?? null);

  // Fetch proposals
  async function fetchProposals() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ brand });
      if (batchId) params.set('batch_id', batchId);
      params.set('status', 'pending');
      params.set('limit', '200');

      const res = await fetch(`/api/approval/proposals?${params}`);
      const json = await res.json();

      if (json.success) {
        const rows: ProposalRow[] = json.data.map((r: any) => ({
          ...r,
          txn_time: r.txn_time,
          summary: r.summary,
          memo: r.memo,
          counterparty_name: r.counterparty_name,
          in_amt: r.in_amt,
          out_amt: r.out_amt,
          use_llm: r.type === 'type1', // type1 defaults to agree
        }));
        setProposals(rows);
      } else {
        setError(json.error ?? '加载失败');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchProposals();
  }, [brand, batchId]);

  // Apply URL params (v2: source/brand/filter) on mount/change
  useEffect(() => {
    if (filterParam === 'pending') setFilter('pending');
    if (brandParam && brandParam !== brand) setBrand(brandParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterParam, brandParam]);

  // Stats
  const stats = useMemo(() => {
    const pending = proposals.filter(p => p.status === 'pending').length;
    const approved = proposals.filter(p => p.status === 'executed').length;
    const rejected = proposals.filter(p => p.status === 'rejected').length;
    const total = proposals.length;
    return { pending, approved, rejected, total };
  }, [proposals]);

  // Filtered list
  const filtered = useMemo(() => {
    if (filter === 'type1') return proposals.filter(p => p.type === 'type1');
    if (filter === 'type2') return proposals.filter(p => p.type === 'type2');
    if (filter === 'pending') return proposals.filter(p => p.status === 'pending');
    return proposals;
  }, [proposals, filter]);

  // Selection
  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const selectable = filtered.filter(p => p.status === 'pending');
    if (selectedIds.size === selectable.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectable.map(p => p.proposal_id)));
    }
  }

  // Update a single proposal (patch)
  async function handleUpdate(
    proposal_id: string,
    patch: Partial<Pick<ProposalRow, 'final_lvl1_code' | 'final_lvl2_code' | 'final_keyword' | 'final_match_field' | 'final_match_field2' | 'final_match_value2' | 'use_llm'>>,
    _note?: string
  ) {
    setSavingIds(prev => new Set(prev).add(proposal_id));
    try {
      const res = await fetch('/api/approval/proposals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposal_id,
          final_lvl1_code: patch.final_lvl1_code,
          final_lvl2_code: patch.final_lvl2_code,
          final_keyword: patch.final_keyword,
          final_match_field: patch.final_match_field,
          final_match_field2: patch.final_match_field2,
          final_match_value2: patch.final_match_value2,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setProposals(prev =>
          prev.map(p =>
            p.proposal_id === proposal_id
              ? { ...p, ...patch }
              : p
          )
        );
      }
    } finally {
      setSavingIds(prev => {
        const next = new Set(prev);
        next.delete(proposal_id);
        return next;
      });
    }
  }

  // Single approve/reject
  async function handleSingleApprove(proposal_id: string) {
    setSavingIds(prev => new Set(prev).add(proposal_id));
    try {
      const res = await fetch('/api/approval/proposals/batch-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve',
          proposal_ids: [proposal_id],
          resolved_by: 'user',
          brand,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setProposals(prev =>
          prev.map(p =>
            p.proposal_id === proposal_id
              ? { ...p, status: json.executed > 0 ? 'executed' : 'pending' }
              : p
          )
        );
        await fetchProposals();
      }
    } finally {
      setSavingIds(prev => {
        const next = new Set(prev);
        next.delete(proposal_id);
        return next;
      });
    }
  }

  async function handleSingleReject(proposal_id: string) {
    setSavingIds(prev => new Set(prev).add(proposal_id));
    try {
      const res = await fetch('/api/approval/proposals/batch-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reject',
          proposal_ids: [proposal_id],
          resolved_by: 'user',
          brand,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setProposals(prev =>
          prev.map(p =>
            p.proposal_id === proposal_id ? { ...p, status: 'rejected' } : p
          )
        );
        await fetchProposals();
      }
    } finally {
      setSavingIds(prev => {
        const next = new Set(prev);
        next.delete(proposal_id);
        return next;
      });
    }
  }

  // Batch approve/reject
  async function handleBatchApprove() {
    if (selectedIds.size === 0) return;
    setBatchLoading(true);
    try {
      const res = await fetch('/api/approval/proposals/batch-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve',
          proposal_ids: Array.from(selectedIds),
          resolved_by: 'user',
          brand,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setProposals(prev =>
          prev.map(p =>
            selectedIds.has(p.proposal_id)
              ? { ...p, status: 'executed' }
              : p
          )
        );
        setSelectedIds(new Set());
        await fetchProposals();
      }
    } finally {
      setBatchLoading(false);
    }
  }

  async function handleBatchReject() {
    if (selectedIds.size === 0) return;
    setBatchLoading(true);
    try {
      const res = await fetch('/api/approval/proposals/batch-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reject',
          proposal_ids: Array.from(selectedIds),
          resolved_by: 'user',
          brand,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setProposals(prev =>
          prev.map(p =>
            selectedIds.has(p.proposal_id) ? { ...p, status: 'rejected' } : p
          )
        );
        setSelectedIds(new Set());
        await fetchProposals();
      }
    } finally {
      setBatchLoading(false);
    }
  }

  // Batch-set classification on selected rows
  const handleBatchSetClassification = useCallback(
    (lvl1Code: string, lvl2Code: string | null, keyword: string, matchField: string, matchField2: string, matchValue2: string) => {
      const ids = Array.from(selectedIds);
      setProposals(prev =>
        prev.map(p =>
          selectedIds.has(p.proposal_id)
            ? { ...p, final_lvl1_code: lvl1Code, final_lvl2_code: lvl2Code, final_keyword: keyword, final_match_field: matchField, final_match_field2: matchField2 || null, final_match_value2: matchValue2 || null }
            : p
        )
      );
      // Persist each in background
      ids.forEach(id => {
        handleUpdate(id, { final_lvl1_code: lvl1Code, final_lvl2_code: lvl2Code, final_keyword: keyword, final_match_field: matchField, final_match_field2: matchField2 || null, final_match_value2: matchValue2 || null });
      });
    },
    [selectedIds]
  );

  const selectedProposals = useMemo(
    () => proposals.filter(p => selectedIds.has(p.proposal_id)),
    [proposals, selectedIds]
  );

  const selectableRows = filtered.filter(p => p.status === 'pending');

  return (
    <div className="min-h-screen pb-20">
      {/* Banner for unmatched-analysis batch (v2) */}
      {source === 'unmatched' && batchId && (
        <div className="bg-blue-50 border border-blue-200 rounded p-3 mx-6 mt-4 mb-4 text-sm">
          📌 来自未配分析批次 <code className="font-mono text-xs">{batchId.slice(0, 8)}</code>,
          共 <b>{proposals.filter(p => p.batch_id === batchId).length}</b> 条建议,
          已为你筛选 <code>status='pending'</code> 的项。
        </div>
      )}

      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">银行流水分类审批</h1>
          {batchId && (
            <div className="text-sm text-gray-500">
              批次: <span className="font-mono text-xs">{batchId.slice(0, 8)}...</span>
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-6 mt-3 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="text-gray-500">待处理:</span>
            <span className="font-bold text-blue-600">{stats.pending}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-gray-500">已批准:</span>
            <span className="font-bold text-green-600">{stats.approved}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-gray-500">已否决:</span>
            <span className="font-bold text-red-600">{stats.rejected}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-gray-500">总计:</span>
            <span className="font-bold text-gray-700">{stats.total}</span>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-white border-b px-6 py-3">
        <div className="flex items-center gap-1">
          {(['all', 'type1', 'type2'] as FilterTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                filter === tab
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tab === 'all' ? '全部' : tab === 'type1' ? '有推荐' : '待补充'}
            </button>
          ))}
          <div className="ml-auto text-xs text-gray-400">
            {filtered.length} 条记录
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-6 mt-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          错误: {error}
        </div>
      )}

      {/* Table */}
      <div className="mx-6 mt-4 bg-white border rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16 text-gray-500">加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <div className="text-lg mb-1">暂无审批数据</div>
            <div className="text-sm">该批次下没有待处理的审批项</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={selectableRows.length > 0 && selectedIds.size === selectableRows.length}
                      onChange={toggleSelectAll}
                      className="rounded"
                    />
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">时间</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">对方</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">摘要</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">金额</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">类型</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">分类方案</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filtered.map(proposal => (
                  <ApprovalRow
                    key={proposal.proposal_id}
                    proposal={proposal}
                    selected={selectedIds.has(proposal.proposal_id)}
                    onToggle={toggleSelect}
                    onUpdate={handleUpdate}
                    onApprove={handleSingleApprove}
                    onReject={handleSingleReject}
                    savingIds={savingIds}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Batch toolbar */}
      <BatchToolbar
        selectedProposals={selectedProposals}
        onBatchApprove={handleBatchApprove}
        onBatchReject={handleBatchReject}
        onBatchSetClassification={handleBatchSetClassification}
        batchLoading={batchLoading}
      />
    </div>
  );
}

export default function ApprovalsPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-16 text-gray-500">加载中...</div>}>
      <ApprovalsContent />
    </Suspense>
  );
}