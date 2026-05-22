'use client';

import { useEffect, useRef, useState } from 'react';
import type { UnclassifiedTxn } from '@/lib/types';
import { useBrand } from '@/lib/brand-context';

// 一级/二级分类选项（必须与数据库字典表 dim_category_lvl1/lvl2 的 *name* 完全一致）
// 否则后端会报：Invalid lvl2 name
const LVL1_OPTIONS = [
  '营业收入',
  '其他收入',
  '租金物业',
  '人力',
  '运费',
  '管理费用',
  '材料采购',
  '营建费用',
  '营销费用',
  '其他费用'
];

// 方向约束：用于限制分类下拉（收入只能选收入类，支出只能选支出类）
const LVL1_DIRECTION: Record<string, 'in'|'out'> = {
  '营业收入': 'in',
  '其他收入': 'in',

  '租金物业': 'out',
  '人力': 'out',
  '运费': 'out',
  '管理费用': 'out',
  '材料采购': 'out',
  '营建费用': 'out',
  '营销费用': 'out',
  '其他费用': 'out'
};

function txnDirection(txn: { in_amt: any; out_amt: any }): 'in'|'out'|'any' {
  const inAmt = Number(txn?.in_amt || 0);
  const outAmt = Number(txn?.out_amt || 0);
  if (inAmt > 0) return 'in';
  if (outAmt > 0) return 'out';
  return 'any';
}

function allowedLvl1ByDirection(direction: 'in'|'out'|'any'): string[] {
  if (direction === 'any') return LVL1_OPTIONS;
  return LVL1_OPTIONS.filter(name => LVL1_DIRECTION[name] === direction);
}

const LVL2_OPTIONS: Record<string, string[]> = {
  '营业收入': ['美团', '饿了么', '抖音', '京东', '微信/财付通', '支付宝', '其他渠道'],
  '其他收入': ['注资', '借款', '贷款', '利息', '退税', '退款'],

  '租金物业': ['租金', '物业费', '水电费'],
  '人力': ['工资', '社保', '劳务派遣', '人力服务'],
  '运费': ['货拉拉', '快递', '同城配送', '其他运费'],

  '管理费用': ['系统使用费', '办公费用', '差旅费', '维修费', '其他管理', '银行手续费', '支付通道费'],
  '材料采购': ['原材料', '辅料', '包装', '其他采购'],

  '营建费用': ['工程款', '施工费', '装修费', '设备采购', '其他营建'],
  '营销费用': ['广告费', '礼品费', '推广费', '营销费', '其他营销'],

  // 其他费用（二级）
  '其他费用': ['税金', '还款']
};

// 待发送队列项类型
interface PendingItem {
  bank_txn_id: number;
  lvl1: string;
  lvl2?: string;
  keyword: string;
  counterparty_name?: string;
  summary?: string;
  memo?: string;
  purpose?: string;
  txn_time?: string;
  in_amt?: number;
  out_amt?: number;
}

// 冲突记录类型
interface ConflictRule {
  rule_id: number;
  priority: number;
  match_field: string;
  match_value: string;
  lvl1: string;
  lvl2: string | null;
  note: string | null;
}

export default function MatchPage() {
  const { brand } = useBrand();

  const [txns, setTxns] = useState<UnclassifiedTxn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState<string>('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchLvl1, setBatchLvl1] = useState('');
  const [batchLvl2, setBatchLvl2] = useState('');
  const [batchSaving, setBatchSaving] = useState(false);

  // 规则沉淀相关状态
  const [showSettleModal, setShowSettleModal] = useState(false);
  const [settleTxn, setSettleTxn] = useState<UnclassifiedTxn | null>(null);
  const [settleLvl1, setSettleLvl1] = useState('');
  const [settleLvl2, setSettleLvl2] = useState('');
  const [settleKeyword, setSettleKeyword] = useState('');
  const [settleMatchField, setSettleMatchField] = useState<'summary'|'memo'|'purpose'|'counterparty_name'>('summary');
  const [settleMatchType, setSettleMatchType] = useState<'contains'|'exact'>('contains');
  const [settleSaving, setSettleSaving] = useState(false);
  const [settleError, setSettleError] = useState<string | null>(null);

  // 冲突检测相关状态（单个）
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [conflictRules, setConflictRules] = useState<ConflictRule[]>([]);
  const [useDualMatch, setUseDualMatch] = useState(false);

  // 待发送队列（仅存于内存，页面刷新即清空）
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [showPendingExpanded, setShowPendingExpanded] = useState(false);

  // 批量沉淀相关状态
  const [showBatchSettleModal, setShowBatchSettleModal] = useState(false);
  const [batchSettleLoading, setBatchSettleLoading] = useState(false);
  const [batchConflicts, setBatchConflicts] = useState<Array<{
    item: PendingItem;
    existing_rules: ConflictRule[];
  }>>([]);
  const [batchSettleError, setBatchSettleError] = useState<string | null>(null);

  // 候选推荐相关状态
  const [candidates, setCandidates] = useState<Array<{ candidate: string; score: number }>>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [previewData, setPreviewData] = useState<{
    match_value: string;
    hit_count: number;
    total_amt: number;
    primary_lvl1: string | null;
    lvl1_distribution: Record<string, number>;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // 获取候选项
  async function fetchCandidates(txnId: number) {
    setCandidatesLoading(true);
    try {
      const res = await fetch(`/api/match/candidates?brand=${brand}&bank_txn_id=${txnId}`);
      const data = await res.json();
      if (data.success) {
        setCandidates(data.data.candidates || []);
      }
    } catch (err) {
      console.error('Failed to fetch candidates:', err);
    } finally {
      setCandidatesLoading(false);
    }
  }

  // 预览命中
  async function fetchPreview(matchValue: string) {
    if (!matchValue || matchValue.length < 3) {
      setPreviewData(null);
      return;
    }
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/match/preview?brand=${brand}&match_value=${encodeURIComponent(matchValue)}`);
      const data = await res.json();
      if (data.success) {
        setPreviewData(data.data);
      } else {
        setPreviewData(null);
      }
    } catch (err) {
      console.error('Failed to fetch preview:', err);
      setPreviewData(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  // 选择候选时触发预览
  function handleCandidateSelect(candidate: string) {
    setSettleKeyword(candidate);
    fetchPreview(candidate);
  }

  useEffect(() => {
    fetchUnclassified();
  }, [brand, month, page]);

  async function fetchUnclassified() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('brand', brand);
      if (month) params.set('month', month);
      params.set('page', page.toString());
      params.set('pageSize', '20');

      const res = await fetch(`/api/match?${params}`);
      const data = await res.json();
      if (data.success) {
        setTxns(data.data.items);
        setTotalPages(data.data.totalPages);
      } else {
        setError(data.error);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleBatchOverride() {
    if (selectedIds.length === 0 || !batchLvl1) return;

    setBatchSaving(true);
    try {
      const res = await fetch('/api/match', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand,
          bank_txn_ids: selectedIds,
          lvl1: batchLvl1,
          lvl2: batchLvl2 || null,
          note: '批量人工匹配'
        })
      });
      const data = await res.json();
      if (data.success) {
        // 将选中的流水加入待发送队列
        const newPendingItems: PendingItem[] = selectedIds.map(id => {
          const txn = txns.find(t => t.bank_txn_id === id);
          return {
            bank_txn_id: id,
            lvl1: batchLvl1,
            lvl2: batchLvl2 || undefined,
            keyword: txn?.summary || txn?.memo || txn?.purpose || txn?.counterparty_name || '',
            counterparty_name: txn?.counterparty_name ?? undefined,
            summary: txn?.summary ?? undefined,
            memo: txn?.memo ?? undefined,
            purpose: txn?.purpose ?? undefined,
            txn_time: txn?.txn_time ?? undefined,
            in_amt: txn?.in_amt ?? undefined,
            out_amt: txn?.out_amt ?? undefined
          };
        });
        setPendingItems(prev => [...prev, ...newPendingItems]);

        setShowBatchModal(false);
        setSelectedIds([]);
        setBatchLvl1('');
        setBatchLvl2('');
        fetchUnclassified();
      } else {
        setError(data.error);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBatchSaving(false);
    }
  }

  async function handleSingleOverride(txnId: number, lvl1: string, lvl2?: string) {
    try {
      const res = await fetch('/api/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand,
          bank_txn_id: txnId,
          lvl1,
          lvl2: lvl2 || null,
          note: '人工匹配'
        })
      });
      const data = await res.json();
      if (data.success) {
        // 找到对应的流水信息，加入待发送队列
        const txn = txns.find(t => t.bank_txn_id === txnId);
        if (txn) {
          const pendingItem: PendingItem = {
            bank_txn_id: txnId,
            lvl1,
            lvl2,
            keyword: txn.summary || txn.memo || txn.purpose || txn.counterparty_name || '',
            counterparty_name: txn.counterparty_name ?? undefined,
            summary: txn.summary ?? undefined,
            memo: txn.memo ?? undefined,
            purpose: txn.purpose ?? undefined,
            txn_time: txn.txn_time ?? undefined,
            in_amt: txn.in_amt ?? undefined,
            out_amt: txn.out_amt ?? undefined
          };
          setPendingItems(prev => [...prev, pendingItem]);
        }
        fetchUnclassified();
      } else {
        setError(data.error);
      }
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleUndo(txnId: number) {
    try {
      const res = await fetch(`/api/match/override?bank_txn_id=${txnId}&brand=${brand}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        // 从待发送队列中移除
        setPendingItems(prev => prev.filter(item => item.bank_txn_id !== txnId));
        fetchUnclassified();
      } else {
        setError(data.error);
      }
    } catch (err: any) {
      setError(err.message);
    }
  }

  // 清除所有待发送队列
  function clearPendingItems() {
    setPendingItems([]);
  }

  // 从待发送队列打开“单条沉淀”弹窗（用户可选择匹配字段/模式/关键词）
  function openSettleModalFromPending(item: PendingItem) {
    const pseudoTxn: UnclassifiedTxn = {
      month: '',
      bank_txn_id: item.bank_txn_id,
      txn_time: item.txn_time || '',
      counterparty_name: item.counterparty_name || null,
      summary: item.summary || null,
      memo: item.memo || null,
      purpose: item.purpose || null,
      in_amt: item.in_amt ?? null,
      out_amt: item.out_amt ?? null,
      balance_amt: null,
      source_file_id: null,
      combined_text: [item.summary, item.memo, item.purpose, item.counterparty_name].filter(Boolean).join(' ')
    };

    openSettleModal(pseudoTxn);
    setSettleLvl1(item.lvl1);
    setSettleLvl2(item.lvl2 || '');
  }

  // 发送/沉淀为规则
  async function handleBatchSettle() {
    if (pendingItems.length === 0) return;

    // 当前先优先把单条场景走“可解释的沉淀弹窗”
    if (pendingItems.length === 1) {
      openSettleModalFromPending(pendingItems[0]);
      return;
    }

    setBatchSettleLoading(true);
    setBatchSettleError(null);

    try {
      const res = await fetch('/api/rules/settle-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand,
          items: pendingItems.map(item => ({
            bank_txn_id: item.bank_txn_id,
            lvl1: item.lvl1,
            lvl2: item.lvl2,
            keyword: item.keyword,
            counterparty_name: item.counterparty_name
          })),
          use_dual_match: false
        })
      });

      const data = await res.json();

      if (data.success) {
        // 全部成功
        alert(`成功沉淀 ${data.created?.length || 0} 条规则！`);
        setPendingItems([]);
        fetchUnclassified();
      } else if (data.code === 'CONFLICTS_DETECTED') {
        // 有冲突，显示冲突弹窗
        setBatchConflicts(data.conflicts);
        setShowBatchSettleModal(true);
      } else {
        setBatchSettleError(data.error || '沉淀失败');
      }
    } catch (err: any) {
      setBatchSettleError(err.message);
    } finally {
      setBatchSettleLoading(false);
    }
  }

  // 使用双重匹配解决批量沉淀冲突
  async function handleBatchDualMatchSettle() {
    if (batchConflicts.length === 0) return;

    setBatchSettleLoading(true);
    setBatchSettleError(null);

    try {
      const res = await fetch('/api/rules/settle-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand,
          items: pendingItems.map(item => ({
            bank_txn_id: item.bank_txn_id,
            lvl1: item.lvl1,
            lvl2: item.lvl2,
            keyword: item.keyword,
            counterparty_name: item.counterparty_name
          })),
          use_dual_match: true
        })
      });

      const data = await res.json();

      if (data.success) {
        alert(`成功沉淀 ${data.created?.length || 0} 条规则（双重匹配）！`);
        setPendingItems([]);
        setShowBatchSettleModal(false);
        setBatchConflicts([]);
        fetchUnclassified();
      } else {
        setBatchSettleError(data.error || '沉淀失败');
      }
    } catch (err: any) {
      setBatchSettleError(err.message);
    } finally {
      setBatchSettleLoading(false);
    }
  }

  // 打开规则沉淀弹窗
  function openSettleModal(txn: UnclassifiedTxn) {
    setSettleTxn(txn);
    
    // 智能推荐匹配字段：summary 优先，其次 memo/purpose，最后 counterparty_name
    let recommendedField: 'summary'|'memo'|'purpose'|'counterparty_name' = 'summary';
    let defaultKeyword = txn.summary || '';
    let recommendedType: 'contains'|'exact' = 'contains';
    
    if (!defaultKeyword && txn.memo) {
      recommendedField = 'memo';
      defaultKeyword = txn.memo;
    } else if (!defaultKeyword && txn.purpose) {
      recommendedField = 'purpose';
      defaultKeyword = txn.purpose;
    } else if (!defaultKeyword && txn.counterparty_name) {
      recommendedField = 'counterparty_name';
      defaultKeyword = txn.counterparty_name;
      recommendedType = 'exact';
    }
    
    setSettleMatchField(recommendedField);
    setSettleMatchType(recommendedType);
    setSettleKeyword(defaultKeyword);
    
    // 获取当前分类（如果有）
    setSettleLvl1('');
    setSettleLvl2('');
    setSettleError(null);
    setUseDualMatch(false);
    setPreviewData(null);
    setShowSettleModal(true);

    // 自动获取候选片段
    fetchCandidates(txn.bank_txn_id);
  }

  // 提交规则沉淀
  async function handleSettleRule() {
    if (!settleTxn || !settleKeyword || !settleLvl1) {
      setSettleError('请填写分类和关键词');
      return;
    }

    setSettleSaving(true);
    setSettleError(null);

    try {
      // 如果用户选择了双重匹配
      const matchField2 = useDualMatch ? 'counterparty_name' : null;
      const matchValue2 = useDualMatch ? (settleTxn.counterparty_name || '') : null;

      const res = await fetch('/api/rules/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand,
          bank_txn_id: settleTxn.bank_txn_id,
          lvl1: settleLvl1,
          lvl2: settleLvl2 || null,
          match_field: settleMatchField,
          match_value: settleKeyword,
          match_field2: matchField2,
          match_value2: matchValue2,
          note: `UI 人工沉淀（${settleMatchField === 'summary' ? '摘要' : settleMatchField === 'memo' ? '附言' : settleMatchField === 'purpose' ? '用途' : '对方单位'}）`
        })
      });

      const data = await res.json();

      if (data.success) {
        // 沉淀成功
        setShowSettleModal(false);
        setShowConflictModal(false);
        // 如果是从待发送队列打开的单条沉淀，成功后清掉队列中对应项
        setPendingItems(prev => prev.filter(item => item.bank_txn_id !== settleTxn.bank_txn_id));
        alert('规则沉淀成功！');
        fetchUnclassified();
      } else if (data.code === 'CONFLICT_DETECTED') {
        // 检测到冲突，显示冲突弹窗
        setConflictRules(data.conflicts);
        setShowConflictModal(true);
      } else {
        const details = data?.error || data?.message || JSON.stringify(data);
        setSettleError(details || '规则沉淀失败');
      }
    } catch (err: any) {
      setSettleError(err.message);
    } finally {
      setSettleSaving(false);
    }
  }

  // 使用双重匹配解决冲突
  async function handleDualMatchSettle() {
    if (!settleTxn) return;

    setSettleSaving(true);
    setSettleError(null);

    try {
      const res = await fetch('/api/rules/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand,
          bank_txn_id: settleTxn.bank_txn_id,
          lvl1: settleLvl1,
          lvl2: settleLvl2 || null,
          match_field: 'summary',
          match_value: settleKeyword,
          match_field2: 'counterparty_name',
          match_value2: settleTxn.counterparty_name || '',
          note: 'UI 人工沉淀（双重匹配）'
        })
      });

      const data = await res.json();

      if (data.success) {
        setShowSettleModal(false);
        setShowConflictModal(false);
        alert('规则沉淀成功（双重匹配）！');
        fetchUnclassified();
      } else {
        const details = data?.error || data?.message || JSON.stringify(data);
        setSettleError(details || '规则沉淀失败');
      }
    } catch (err: any) {
      setSettleError(err.message);
    } finally {
      setSettleSaving(false);
    }
  }

  function toggleSelect(id: number) {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  function toggleSelectAll() {
    if (selectedIds.length === txns.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(txns.map(t => t.bank_txn_id));
    }
  }

  return (
    <div className="space-y-6">
      {/* 待发送队列 */}
      {pendingItems.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="text-yellow-800 font-medium">待发送队列</span>
              <span className="bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded text-sm">
                {pendingItems.length} 条
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setShowPendingExpanded(!showPendingExpanded)}
                className="text-sm text-yellow-700 hover:text-yellow-900 underline"
              >
                {showPendingExpanded ? '收起详情' : '查看详情'}
              </button>
              <button
                onClick={clearPendingItems}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                清空
              </button>
              <button
                onClick={handleBatchSettle}
                disabled={batchSettleLoading}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm"
              >
                {batchSettleLoading ? '处理中...' : `批量沉淀（${pendingItems.length}条）`}
              </button>
            </div>
          </div>

          {/* 展开详情 */}
          {showPendingExpanded && (
            <div className="mt-3 max-h-64 overflow-y-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-yellow-100 sticky top-0">
                  <tr>
                    <th className="px-2 py-1 text-left">流水ID</th>
                    <th className="px-2 py-1 text-left">分类</th>
                    <th className="px-2 py-1 text-left">关键词</th>
                    <th className="px-2 py-1 text-left">对方单位</th>
                    <th className="px-2 py-1 text-center">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pendingItems.map((item, idx) => (
                    <tr key={idx} className="hover:bg-yellow-100">
                      <td className="px-2 py-1">{item.bank_txn_id}</td>
                      <td className="px-2 py-1">{item.lvl1}{item.lvl2 ? `-${item.lvl2}` : ''}</td>
                      <td className="px-2 py-1 max-w-xs truncate">{item.keyword || '-'}</td>
                      <td className="px-2 py-1 max-w-xs truncate">{item.counterparty_name || '-'}</td>
                      <td className="px-2 py-1 text-center">
                        <button
                          onClick={() => openSettleModalFromPending(item)}
                          className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200"
                        >
                          确认沉淀
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">人工匹配</h1>
        {selectedIds.length > 0 && (
          <button
            onClick={() => setShowBatchModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            批量匹配 ({selectedIds.length})
          </button>
        )}
      </div>

      {/* 筛选 */}
      <div className="bg-white shadow rounded-lg p-4">
        <div className="flex items-center space-x-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">月份</label>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="mt-1 block border rounded-md px-3 py-2"
            />
          </div>
          <button
            onClick={() => { setMonth(''); setPage(1); }}
            className="px-4 py-2 border rounded-lg hover:bg-gray-50 mt-4"
          >
            重置
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          错误: {error}
        </div>
      )}

      {/* 列表 */}
      <div className="bg-white shadow rounded-lg overflow-visible">
        <div className="overflow-x-auto overflow-y-visible">
          <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left">
                <input
                  type="checkbox"
                  checked={selectedIds.length === txns.length && txns.length > 0}
                  onChange={toggleSelectAll}
                  className="rounded"
                />
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">时间</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">对方单位</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">摘要</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">收入</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">支出</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">操作</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-gray-500">加载中...</td>
              </tr>
            ) : txns.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-gray-500">暂无未分类流水</td>
              </tr>
            ) : (
              txns.map((txn) => (
                <tr key={txn.bank_txn_id} className={selectedIds.includes(txn.bank_txn_id) ? 'bg-blue-50' : ''}>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(txn.bank_txn_id)}
                      onChange={() => toggleSelect(txn.bank_txn_id)}
                      className="rounded"
                    />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                    {txn.txn_time ? new Date(txn.txn_time).toLocaleString('zh-CN') : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900 max-w-xs truncate">{txn.counterparty_name || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">{txn.summary || txn.memo || '-'}</td>
                  <td className="px-4 py-3 text-sm text-right text-green-600">
                    {txn.in_amt ? `¥${txn.in_amt.toLocaleString()}` : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-right text-red-600">
                    {txn.out_amt ? `¥${txn.out_amt.toLocaleString()}` : '-'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <QuickMatchButton
                      txnId={txn.bank_txn_id}
                      direction={txnDirection(txn as any)}
                      onMatch={handleSingleOverride}
                    />
                    <button
                      onClick={() => handleUndo(txn.bank_txn_id)}
                      className="ml-2 text-xs text-gray-500 hover:text-gray-700"
                    >
                      撤销
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          </table>
        </div>

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <span className="text-sm text-gray-500">第 {page} / {totalPages} 页</span>
            <div className="flex space-x-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 border rounded disabled:opacity-50"
              >
                上一页
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 border rounded disabled:opacity-50"
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 批量匹配弹窗 */}
      {showBatchModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">批量匹配 ({selectedIds.length} 条)</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">一级分类</label>
                <select
                  value={batchLvl1}
                  onChange={(e) => { setBatchLvl1(e.target.value); setBatchLvl2(''); }}
                  className="mt-1 block w-full border rounded-md px-3 py-2"
                >
                  <option value="">选择分类</option>
                  {allowedLvl1ByDirection(
                    (() => {
                      const dirs = selectedIds
                        .map(id => txns.find(t => t.bank_txn_id === id))
                        .filter(Boolean)
                        .map(t => txnDirection(t as any));
                      const uniq = Array.from(new Set(dirs.filter(d => d !== 'any')));
                      return uniq.length === 1 ? (uniq[0] as any) : 'any';
                    })()
                  ).map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
              {batchLvl1 && LVL2_OPTIONS[batchLvl1] && LVL2_OPTIONS[batchLvl1].length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">二级分类</label>
                  <select
                    value={batchLvl2}
                    onChange={(e) => setBatchLvl2(e.target.value)}
                    className="mt-1 block w-full border rounded-md px-3 py-2"
                  >
                    <option value="">选择分类</option>
                    {LVL2_OPTIONS[batchLvl1].map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex justify-end space-x-3 pt-4">
                <button
                  onClick={() => setShowBatchModal(false)}
                  className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  onClick={handleBatchOverride}
                  disabled={!batchLvl1 || batchSaving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {batchSaving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 规则沉淀弹窗 */}
      {showSettleModal && settleTxn && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">沉淀为规则</h2>
            <div className="space-y-4">
              {/* 当前流水信息 */}
              <div className="bg-gray-50 rounded p-3 text-sm">
                <div className="text-gray-500">流水信息：</div>
                <div>对方单位: {settleTxn.counterparty_name || '-'}</div>
                <div>摘要: {settleTxn.summary || '-'}</div>
                <div>金额: {settleTxn.in_amt ? `+${settleTxn.in_amt}` : settleTxn.out_amt ? `-${settleTxn.out_amt}` : '-'}</div>
              </div>

              {/* 分类选择 */}
              <div>
                <label className="block text-sm font-medium text-gray-700">一级分类 *</label>
                <select
                  value={settleLvl1}
                  onChange={(e) => { setSettleLvl1(e.target.value); setSettleLvl2(''); }}
                  className="mt-1 block w-full border rounded-md px-3 py-2"
                >
                  <option value="">选择分类</option>
                  {allowedLvl1ByDirection(txnDirection(settleTxn as any)).map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
              {settleLvl1 && LVL2_OPTIONS[settleLvl1] && LVL2_OPTIONS[settleLvl1].length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">二级分类</label>
                  <select
                    value={settleLvl2}
                    onChange={(e) => setSettleLvl2(e.target.value)}
                    className="mt-1 block w-full border rounded-md px-3 py-2"
                  >
                    <option value="">选择分类</option>
                    {LVL2_OPTIONS[settleLvl1].map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* 匹配字段选择 */}
              <div>
                <label className="block text-sm font-medium text-gray-700">匹配字段 *</label>
                <select
                  value={settleMatchField}
                  onChange={(e) => {
                    const v = e.target.value as 'summary'|'memo'|'purpose'|'counterparty_name';
                    const mt: 'contains'|'exact' = v === 'counterparty_name' ? 'exact' : 'contains';
                    setSettleMatchField(v);
                    setSettleMatchType(mt);
                    // 自动填充该字段的当前值
                    const fieldVal = v === 'summary' ? settleTxn.summary :
                                     v === 'memo' ? settleTxn.memo :
                                     v === 'purpose' ? settleTxn.purpose :
                                     settleTxn.counterparty_name || '';
                    setSettleKeyword(fieldVal || '');
                    fetchPreview(fieldVal || '');
                  }}
                  className="mt-1 block w-full border rounded-md px-3 py-2"
                >
                  <option value="summary">摘要（{settleTxn.summary || '空'}）</option>
                  <option value="memo" disabled={!settleTxn.memo}>附言（{settleTxn.memo || '空'}）</option>
                  <option value="purpose" disabled={!settleTxn.purpose}>用途（{settleTxn.purpose || '空'}）</option>
                  <option value="counterparty_name">对方单位（{settleTxn.counterparty_name || '空'}）</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  系统推荐：{!settleTxn.summary ? '摘要为空，建议使用附言/用途' : '摘要优先'}
                </p>
              </div>

              {/* 匹配模式 */}
              <div>
                <label className="block text-sm font-medium text-gray-700">匹配模式</label>
                <div className="mt-1 flex items-center space-x-3">
                  <label className="flex items-center text-sm">
                    <input
                      type="radio"
                      checked={settleMatchType === 'contains'}
                      onChange={() => setSettleMatchType('contains')}
                      className="mr-2"
                      disabled={settleMatchField === 'counterparty_name'}
                    />
                    模糊匹配（contains）
                  </label>
                  <label className="flex items-center text-sm">
                    <input
                      type="radio"
                      checked={settleMatchType === 'exact'}
                      onChange={() => setSettleMatchType('exact')}
                      className="mr-2"
                    />
                    精确匹配（exact）
                  </label>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {settleMatchField === 'counterparty_name' ? '对方单位默认精确匹配' : '摘要/附言/用途默认模糊匹配'}
                </p>
              </div>

              {/* 关键词输入 */}
              <div>
                <label className="block text-sm font-medium text-gray-700">关键词 *</label>
                <input
                  type="text"
                  value={settleKeyword}
                  onChange={(e) => {
                    setSettleKeyword(e.target.value);
                    // 关键词变化时重新获取预览
                    if (e.target.value.length >= 3) {
                      fetchPreview(e.target.value);
                    } else {
                      setPreviewData(null);
                    }
                  }}
                  placeholder="输入匹配关键词"
                  className="mt-1 block w-full border rounded-md px-3 py-2"
                />
                <p className="text-xs text-gray-500 mt-1">可编辑，建议使用推荐候选（输入3字以上自动预览）</p>
              </div>

              {/* 候选推荐 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">推荐候选</label>
                {candidatesLoading ? (
                  <div className="text-xs text-gray-500">加载中...</div>
                ) : candidates.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {candidates.slice(0, 8).map((c, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          setSettleKeyword(c.candidate);
                          fetchPreview(c.candidate);
                        }}
                        className={`text-xs px-2 py-1 rounded border ${
                          settleKeyword === c.candidate
                            ? 'bg-blue-100 border-blue-500 text-blue-700'
                            : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                        }`}
                        title={`点击使用该候选 (score: ${c.score})`}
                      >
                        {c.candidate}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-gray-400">无可用候选</div>
                )}
              </div>

              {/* 命中预览 */}
              {settleKeyword.length >= 3 && (
                <div className="bg-slate-50 rounded p-3 text-sm">
                  <div className="font-medium text-gray-700 mb-2">命中预览</div>
                  {previewLoading ? (
                    <div className="text-xs text-gray-500">加载中...</div>
                  ) : previewData ? (
                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span className="text-gray-500">历史命中：</span>
                        <span className="font-medium">{previewData.hit_count} 条</span>
                      </div>
                      {previewData.hit_count > 0 && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-gray-500">总金额：</span>
                            <span className="font-medium">¥{previewData.total_amt?.toLocaleString() || 0}</span>
                          </div>
                          {previewData.primary_lvl1 && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">主分类：</span>
                              <span className="font-medium text-blue-600">{previewData.primary_lvl1}</span>
                            </div>
                          )}
                          {Object.keys(previewData.lvl1_distribution).length > 0 && (
                            <div className="mt-2 text-xs text-gray-500">
                              分类分布：
                              {Object.entries(previewData.lvl1_distribution)
                                .sort(([, a], [, b]) => b - a)
                                .slice(0, 5)
                                .map(([lvl1, cnt]) => (
                                  <span key={lvl1} className="mr-2">
                                    {lvl1}: {cnt}
                                  </span>
                                ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-400">无历史命中</div>
                  )}
                </div>
              )}

              {/* 双重匹配选项 */}
              {settleTxn.counterparty_name && (
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="dualMatch"
                    checked={useDualMatch}
                    onChange={(e) => setUseDualMatch(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="dualMatch" className="text-sm text-gray-700">
                    同时匹配对方单位：{settleTxn.counterparty_name}
                  </label>
                </div>
              )}

              {/* 错误提示 */}
              {settleError && (
                <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-600">
                  {settleError}
                </div>
              )}

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  onClick={() => setShowSettleModal(false)}
                  className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  onClick={handleSettleRule}
                  disabled={!settleLvl1 || !settleKeyword || settleSaving}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {settleSaving ? '保存中...' : '沉淀为规则'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 冲突检测弹窗 */}
      {showConflictModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg">
            <h2 className="text-lg font-semibold mb-4 text-orange-600">⚠️ 规则冲突检测</h2>
            <div className="space-y-4">
              <div className="bg-orange-50 border border-orange-200 rounded p-3 text-sm">
                <p>检测到冲突：关键词「{settleKeyword}」已分配给以下分类：</p>
              </div>

              {/* 冲突规则列表 */}
              <div className="max-h-60 overflow-y-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left">规则ID</th>
                      <th className="px-3 py-2 text-left">一级分类</th>
                      <th className="px-3 py-2 text-left">二级分类</th>
                      <th className="px-3 py-2 text-left">关键词</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {conflictRules.map((rule) => (
                      <tr key={rule.rule_id}>
                        <td className="px-3 py-2">{rule.rule_id}</td>
                        <td className="px-3 py-2">{rule.lvl1}</td>
                        <td className="px-3 py-2">{rule.lvl2 || '-'}</td>
                        <td className="px-3 py-2">{rule.match_value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 解决方案 */}
              <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm">
                <p className="font-medium mb-2">解决方案：</p>
                <p>使用<strong>双重匹配</strong>：摘要 + 对方单位同时满足才命中</p>
                {settleTxn && (
                  <p className="mt-1 text-blue-600">
                    匹配条件：摘要包含「{settleKeyword}」<strong>且</strong>对方单位为「{settleTxn.counterparty_name}」
                  </p>
                )}
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  onClick={() => { setShowConflictModal(false); setShowSettleModal(false); }}
                  className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  onClick={handleDualMatchSettle}
                  disabled={settleSaving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {settleSaving ? '保存中...' : '使用双重匹配'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 批量沉淀冲突检测弹窗 */}
      {showBatchSettleModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
            <h2 className="text-lg font-semibold mb-4 text-orange-600">⚠️ 规则冲突检测</h2>
            <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
              <div className="bg-orange-50 border border-orange-200 rounded p-3 text-sm">
                <p>检测到 {batchConflicts.length} 条冲突：以下关键词已分配给其他分类</p>
              </div>

              {/* 冲突列表 */}
              <div className="flex-1 overflow-y-auto">
                {batchConflicts.map((conflict, idx) => (
                  <div key={idx} className="border rounded mb-3 p-3">
                    <div className="font-medium text-sm mb-2">
                      流水 {conflict.item.bank_txn_id}：关键词「{conflict.item.keyword}」
                    </div>
                    <table className="min-w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-2 py-1 text-left">规则ID</th>
                          <th className="px-2 py-1 text-left">一级分类</th>
                          <th className="px-2 py-1 text-left">二级分类</th>
                          <th className="px-2 py-1 text-left">关键词</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {conflict.existing_rules.map((rule) => (
                          <tr key={rule.rule_id}>
                            <td className="px-2 py-1">{rule.rule_id}</td>
                            <td className="px-2 py-1">{rule.lvl1}</td>
                            <td className="px-2 py-1">{rule.lvl2 || '-'}</td>
                            <td className="px-2 py-1">{rule.match_value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>

              {/* 解决方案 */}
              <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm">
                <p className="font-medium mb-2">解决方案：</p>
                <p>使用<strong>双重匹配</strong>：摘要 + 对方单位同时满足才命中</p>
                <p className="mt-1 text-blue-600">
                  匹配条件：摘要包含关键词 <strong>且</strong> 对方单位匹配
                </p>
              </div>

              {/* 错误提示 */}
              {batchSettleError && (
                <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-600">
                  {batchSettleError}
                </div>
              )}

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  onClick={() => { setShowBatchSettleModal(false); setBatchConflicts([]); }}
                  className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  onClick={handleBatchDualMatchSettle}
                  disabled={batchSettleLoading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {batchSettleLoading ? '处理中...' : `对冲突项启用双重匹配（${batchConflicts.length}条）`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 快速匹配按钮组件
// 注意：table/overflow 场景下，absolute 的二级菜单容易被裁剪。
// 这里改为 fixed 定位 + 单层面板（左一级/右二级），彻底避免二级菜单显示不全。
function QuickMatchButton({
  txnId,
  direction,
  onMatch,
}: {
  txnId: number;
  direction: 'in'|'out'|'any';
  onMatch: (id: number, lvl1: string, lvl2?: string) => void;
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const [showMenu, setShowMenu] = useState(false);
  const initialLvl1 = allowedLvl1ByDirection(direction)[0] || LVL1_OPTIONS[0];
  const [activeLvl1, setActiveLvl1] = useState<string>(initialLvl1);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  function openMenu() {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) {
      setShowMenu(true);
      return;
    }

    const MENU_W = 360;
    const MENU_H = 320;
    const GAP = 6;

    let left = rect.right - MENU_W; // 右对齐按钮
    let top = rect.bottom + GAP;

    // 防止超出屏幕
    left = Math.max(8, Math.min(left, window.innerWidth - MENU_W - 8));
    if (top + MENU_H > window.innerHeight - 8) {
      top = Math.max(8, rect.top - MENU_H - GAP); // 放不下就向上展开
    }

    setPos({ top, left });
    setShowMenu(true);
  }

  function closeMenu() {
    setShowMenu(false);
  }

  useEffect(() => {
    if (!showMenu) return;

    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (btnRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      closeMenu();
    }

    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') closeMenu();
    }

    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [showMenu]);

  const lvl2List = LVL2_OPTIONS[activeLvl1] || [];

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => (showMenu ? closeMenu() : openMenu())}
        className="text-xs px-2 py-1 bg-blue-100 text-blue-600 rounded hover:bg-blue-200"
      >
        匹配
      </button>

      {showMenu && pos && (
        <div
          ref={menuRef}
          className="fixed bg-white border rounded-lg shadow-lg z-[9999]"
          style={{ top: pos.top, left: pos.left, width: 360, maxHeight: 320 }}
        >
          <div className="flex">
            {/* 左侧：一级分类 */}
            <div className="w-44 border-r max-h-80 overflow-y-auto">
              {allowedLvl1ByDirection(direction).map((lvl1) => (
                <button
                  key={lvl1}
                  onMouseEnter={() => setActiveLvl1(lvl1)}
                  onClick={() => {
                    onMatch(txnId, lvl1);
                    closeMenu();
                  }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 ${
                    activeLvl1 === lvl1 ? 'bg-gray-50 font-medium' : ''
                  }`}
                >
                  {lvl1}
                </button>
              ))}
            </div>

            {/* 右侧：二级分类（可空） */}
            <div className="flex-1 max-h-80 overflow-y-auto">
              {lvl2List.length === 0 ? (
                <div className="px-3 py-2 text-sm text-gray-400">无二级分类</div>
              ) : (
                lvl2List.map((lvl2) => (
                  <button
                    key={lvl2}
                    onClick={() => {
                      onMatch(txnId, activeLvl1, lvl2);
                      closeMenu();
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100"
                  >
                    {activeLvl1}-{lvl2}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
