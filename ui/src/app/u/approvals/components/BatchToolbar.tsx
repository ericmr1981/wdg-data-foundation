'use client';

import { useState } from 'react';
import { allowedLvl1ByDirection, txnDirection, LVL2_OPTIONS } from './approval-lvl-data';
import { lvl1NameToCode, lvl2NameToCode } from './ApprovalDetail';
import type { ProposalRow } from './types';

interface BatchToolbarProps {
  selectedProposals: ProposalRow[];
  onBatchApprove: () => void;
  onBatchReject: () => void;
  onBatchSetClassification: (lvl1Code: string, lvl2Code: string | null, keyword: string, matchField: string, matchField2: string, matchValue2: string) => void;
  batchLoading: boolean;
}

export default function BatchToolbar({
  selectedProposals,
  onBatchApprove,
  onBatchReject,
  onBatchSetClassification,
  batchLoading,
}: BatchToolbarProps) {
  const [lvl1Name, setLvl1Name] = useState('');
  const [lvl2Name, setLvl2Name] = useState('');
  const [keyword, setKeyword] = useState('');
  const [matchField, setMatchField] = useState('summary');
  const [matchField2, setMatchField2] = useState('');
  const [matchValue2, setMatchValue2] = useState('');

  if (selectedProposals.length === 0) return null;

  // Compute common direction across selected rows
  const dirs = selectedProposals.map(p => txnDirection(p as any));
  const uniqDirs = [...new Set(dirs.filter(d => d !== 'any'))];
  const commonDir = uniqDirs.length === 1 ? uniqDirs[0] as 'in' | 'out' : 'any';
  const allowedLvl1 = allowedLvl1ByDirection(commonDir);
  const lvl2List = lvl1Name ? (LVL2_OPTIONS[lvl1Name] ?? []) : [];

  function handleApplyToSelected() {
    if (!lvl1Name) return;
    const lvl1Code = lvl1NameToCode(lvl1Name);
    const lvl2Code = lvl2Name ? lvl2NameToCode(lvl1Code, lvl2Name) : null;
    onBatchSetClassification(lvl1Code, lvl2Code, keyword, matchField, matchField2, matchValue2);
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-300 shadow-[0_-4px_12px_rgba(0,0,0,0.08)] z-40">
      <div className="max-w-screen-xl mx-auto px-6 py-3 flex items-center gap-4">
        {/* Selected count */}
        <div className="flex-shrink-0 text-sm text-gray-700 font-medium">
          已选择 <span className="text-blue-600">{selectedProposals.length}</span> 条
        </div>

        <div className="w-px h-8 bg-gray-300" />

        {/* Quick-set controls */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-xs text-gray-500 flex-shrink-0">快速设置:</span>

          <select
            value={lvl1Name}
            onChange={e => { setLvl1Name(e.target.value); setLvl2Name(''); }}
            className="border rounded px-2 py-1.5 text-sm bg-white w-36"
          >
            <option value="">一级分类</option>
            {allowedLvl1.map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>

          <select
            value={lvl2Name}
            onChange={e => setLvl2Name(e.target.value)}
            disabled={!lvl1Name || lvl2List.length === 0}
            className="border rounded px-2 py-1.5 text-sm bg-white w-32 disabled:bg-gray-100"
          >
            <option value="">二级分类</option>
            {lvl2List.map(o => (
              <option key={o.name} value={o.name}>{o.name}</option>
            ))}
          </select>

          <input
            type="text"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            placeholder="关键词"
            className="border rounded px-2 py-1.5 text-sm w-40"
          />

          <select
            value={matchField}
            onChange={e => setMatchField(e.target.value)}
            className="border rounded px-2 py-1.5 text-sm bg-white w-24"
          >
            <option value="summary">摘要</option>
            <option value="memo">附言</option>
            <option value="purpose">用途</option>
            <option value="counterparty_name">对方</option>
          </select>

          <select
            value={matchField2}
            onChange={e => setMatchField2(e.target.value)}
            className="border rounded px-2 py-1.5 text-sm bg-white w-24"
          >
            <option value="">（无）</option>
            <option value="summary">摘要</option>
            <option value="memo">附言</option>
            <option value="purpose">用途</option>
            <option value="counterparty_name">对方</option>
          </select>

          <input
            type="text"
            value={matchValue2}
            onChange={e => setMatchValue2(e.target.value)}
            placeholder="条件2关键词"
            className="border rounded px-2 py-1.5 text-sm w-28"
          />

          <button
            onClick={handleApplyToSelected}
            disabled={!lvl1Name}
            className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-40"
          >
            应用到选中
          </button>
        </div>

        <div className="w-px h-8 bg-gray-300 flex-shrink-0" />

        {/* Batch action buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={onBatchApprove}
            disabled={batchLoading}
            className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-40"
          >
            {batchLoading ? '处理中...' : `批准选中的 (${selectedProposals.length})`}
          </button>
          <button
            onClick={onBatchReject}
            disabled={batchLoading}
            className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-40"
          >
            否决选中的
          </button>
        </div>
      </div>
    </div>
  );
}