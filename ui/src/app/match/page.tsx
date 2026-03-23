'use client';

import { useEffect, useRef, useState } from 'react';
import type { UnclassifiedTxn } from '@/lib/types';

// 一级分类选项
const LVL1_OPTIONS = [
  '营业收入', '运费', '租金', '人力成本', '管理费用', '财务费用',
  '物料采购', '销售费用', '营建费用','其他收入', '其他支出'
];

// 二级分类选项
const LVL2_OPTIONS: Record<string, string[]> = {
  '营业收入': ['美团', '饿了么', '抖音', '支付宝', '微信', '现金', '其他'],
  '运费': ['顺丰', '中通', '圆通', '韵达', '其他'],
  '租金': ['物业', '房东'],
  '人力成本': ['工资', '社保', '奖金'],
  '物料采购': ['食材', '包装', '耗材'],
  '财务费用': ['税金支出','其他',],
  '销售费用': ['推广','其他',],

  // 其他收入
  '其他收入': ['注资', '借款', '贷款', '利息', '退税', '退款'],

  // 管理费用
  '管理费用': ['报销', '准备金', '其他'],

  // 兜底
  '其他': []
};

// 待发送队列项类型
interface PendingItem {
  bank_txn_id: number;
  lvl1: string;
  lvl2?: string;
  keyword: string;
  counterparty_name?: string;
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

  useEffect(() => {
    fetchUnclassified();
  }, [month, page]);

  async function fetchUnclassified() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
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
            keyword: txn?.summary || '',
            counterparty_name: txn?.counterparty_name ?? undefined,
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
            keyword: txn.summary || '',
            counterparty_name: txn.counterparty_name ?? undefined,
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
      const res = await fetch(`/api/match/override?bank_txn_id=${txnId}`, { method: 'DELETE' });
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

  // 发送/沉淀为规则
  async function handleBatchSettle() {
    if (pendingItems.length === 0) return;

    setBatchSettleLoading(true);
    setBatchSettleError(null);

    try {
      const res = await fetch('/api/rules/settle-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
    // 默认使用摘要作为关键词
    const defaultKeyword = txn.summary || '';
    setSettleKeyword(defaultKeyword);
    // 获取当前分类（如果有）
    setSettleLvl1('');
    setSettleLvl2('');
    setSettleError(null);
    setUseDualMatch(false);
    setShowSettleModal(true);
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
          bank_txn_id: settleTxn.bank_txn_id,
          lvl1: settleLvl1,
          lvl2: settleLvl2 || null,
          match_field: 'summary',
          match_value: settleKeyword,
          match_field2: matchField2,
          match_value2: matchValue2,
          note: 'UI 人工沉淀'
        })
      });

      const data = await res.json();

      if (data.success) {
        // 沉淀成功
        setShowSettleModal(false);
        setShowConflictModal(false);
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
                {batchSettleLoading ? '处理中...' : `发送/沉淀为规则（${pendingItems.length}条）`}
              </button>
            </div>
          </div>

          {/* 展开详情 */}
          {showPendingExpanded && (
            <div className="mt-3 max-h-48 overflow-y-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-yellow-100 sticky top-0">
                  <tr>
                    <th className="px-2 py-1 text-left">流水ID</th>
                    <th className="px-2 py-1 text-left">分类</th>
                    <th className="px-2 py-1 text-left">关键词</th>
                    <th className="px-2 py-1 text-left">对方单位</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pendingItems.map((item, idx) => (
                    <tr key={idx} className="hover:bg-yellow-100">
                      <td className="px-2 py-1">{item.bank_txn_id}</td>
                      <td className="px-2 py-1">{item.lvl1}{item.lvl2 ? `-${item.lvl2}` : ''}</td>
                      <td className="px-2 py-1 max-w-xs truncate">{item.keyword || '-'}</td>
                      <td className="px-2 py-1 max-w-xs truncate">{item.counterparty_name || '-'}</td>
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
                  {LVL1_OPTIONS.map(opt => (
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
                  {LVL1_OPTIONS.map(opt => (
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

              {/* 关键词输入 */}
              <div>
                <label className="block text-sm font-medium text-gray-700">关键词 *</label>
                <input
                  type="text"
                  value={settleKeyword}
                  onChange={(e) => setSettleKeyword(e.target.value)}
                  placeholder="输入匹配关键词"
                  className="mt-1 block w-full border rounded-md px-3 py-2"
                />
                <p className="text-xs text-gray-500 mt-1">默认使用摘要，可编辑</p>
              </div>

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
  onMatch,
}: {
  txnId: number;
  onMatch: (id: number, lvl1: string, lvl2?: string) => void;
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const [showMenu, setShowMenu] = useState(false);
  const [activeLvl1, setActiveLvl1] = useState<string>(LVL1_OPTIONS[0]);
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
              {LVL1_OPTIONS.map((lvl1) => (
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
