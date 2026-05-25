'use client';

import { useState } from 'react';
import type { ProposalRow } from './types';
import ApprovalDetail from './ApprovalDetail';
import { lvl1CodeToName } from './ApprovalDetail';

interface ApprovalRowProps {
  proposal: ProposalRow;
  selected: boolean;
  onToggle: (proposal_id: string) => void;
  onUpdate: (proposal_id: string, patch: Partial<Pick<ProposalRow, 'final_lvl1_code' | 'final_lvl2_code' | 'final_keyword' | 'final_match_field' | 'use_llm'>>, note?: string) => void;
  onApprove: (proposal_id: string) => void;
  onReject: (proposal_id: string) => void;
  savingIds: Set<string>;
}

export default function ApprovalRow({ proposal, selected, onToggle, onUpdate, onApprove, onReject, savingIds }: ApprovalRowProps) {
  const [expanded, setExpanded] = useState(false);
  const isType1 = proposal.type === 'type1';
  const saving = savingIds.has(proposal.proposal_id);
  const isDone = proposal.status === 'executed' || proposal.status === 'rejected';

  const statusBadge = (() => {
    if (proposal.status === 'executed') {
      return <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-800">已批准</span>;
    }
    if (proposal.status === 'rejected') {
      return <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-800">已否决</span>;
    }
    if (isType1) {
      return <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-800">有推荐</span>;
    }
    return <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-800">待补充</span>;
  })();

  // Preview: show LLM recommendation (type1) or empty (type2)
  const previewLvl1 = proposal.final_lvl1_code
    ? lvl1CodeToName(proposal.final_lvl1_code)
    : (isType1 && proposal.llm_lvl1_code ? lvl1CodeToName(proposal.llm_lvl1_code) : null);
  const previewLvl2 = proposal.final_lvl2_code
    ? lvl1CodeToName(proposal.final_lvl2_code)
    : (isType1 && proposal.llm_lvl2_code ? lvl1CodeToName(proposal.llm_lvl2_code) : null);
  const previewKeyword = proposal.final_keyword ?? (isType1 ? proposal.llm_keyword : null);

  return (
    <>
      <tr
        className={`border-b hover:bg-slate-50 transition-colors cursor-pointer ${selected ? 'bg-blue-50' : ''} ${isDone ? 'opacity-60' : ''}`}
        onClick={() => setExpanded(e => !e)}
      >
        {/* Checkbox */}
        <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle(proposal.proposal_id)}
            disabled={isDone}
            className="rounded"
          />
        </td>

        {/* Time */}
        <td className="px-3 py-3 text-sm text-gray-700 whitespace-nowrap">
          {proposal.txn_time ? new Date(proposal.txn_time).toLocaleDateString('zh-CN') : '-'}
        </td>

        {/* Counterparty */}
        <td className="px-3 py-3 text-sm max-w-[150px] truncate" title={proposal.counterparty_name ?? undefined}>
          {proposal.counterparty_name || '-'}
        </td>

        {/* Summary */}
        <td className="px-3 py-3 text-sm text-gray-500 max-w-[180px] truncate" title={proposal.summary ?? undefined}>
          {proposal.summary || proposal.memo || '-'}
        </td>

        {/* Amount */}
        <td className="px-3 py-3 text-sm text-right font-mono whitespace-nowrap">
          {(proposal.in_amt ?? 0) > 0 ? (
            <span className="text-green-600">
              +{(proposal.in_amt ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          ) : (
            <span className="text-red-600">
              -{Math.abs(Number(proposal.out_amt ?? 0)).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          )}
        </td>

        {/* Type badge */}
        <td className="px-3 py-3">{statusBadge}</td>

        {/* Classification preview */}
        <td className="px-3 py-3 text-sm">
          {previewLvl1 ? (
            <div>
              <span className={isType1 ? 'text-green-700' : 'text-gray-700'}>
                {previewLvl1}
              </span>
              {previewLvl2 && <span className="text-gray-400"> / {previewLvl2}</span>}
              {previewKeyword && (
                <div className="text-xs text-gray-400 truncate max-w-[120px]" title={previewKeyword}>
                  关键词: {previewKeyword}
                </div>
              )}
            </div>
          ) : (
            <span className="text-gray-400 text-xs">未选择</span>
          )}
        </td>

        {/* Action */}
        <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => setExpanded(e => !e)}
            className={`text-xs px-2 py-1 rounded border transition-colors ${
              expanded
                ? 'bg-gray-200 text-gray-700'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {expanded ? '收起' : '详情'}
          </button>
        </td>
      </tr>

      {/* Expanded detail */}
      {expanded && (
        <tr className="border-b border-gray-200">
          <td colSpan={8} className="p-0">
            <ApprovalDetail
              proposal={proposal}
              onUpdate={onUpdate}
              onApprove={onApprove}
              onReject={onReject}
              saving={saving}
            />
          </td>
        </tr>
      )}
    </>
  );
}