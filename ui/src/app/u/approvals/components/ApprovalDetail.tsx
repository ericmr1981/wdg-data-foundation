'use client';

import { useState } from 'react';
import type { ProposalRow } from './types';
import { LVL1_OPTIONS, LVL2_OPTIONS, txnDirection, allowedLvl1ByDirection } from './approval-lvl-data';

interface ApprovalDetailProps {
  proposal: ProposalRow;
  onUpdate: (proposal_id: string, patch: Partial<Pick<ProposalRow, 'final_lvl1_code' | 'final_lvl2_code' | 'final_keyword' | 'final_match_field' | 'final_match_field2' | 'final_match_value2' | 'use_llm'>>, note?: string) => void;
  onApprove: (proposal_id: string) => void;
  onReject: (proposal_id: string) => void;
  saving?: boolean;
}

// Maps lvl1_code → lvl1_name using the static option list
export function lvl1CodeToName(code: string | null): string {
  if (!code) return '';
  return LVL1_OPTIONS.find(o => o.code === code)?.name ?? code;
}

// Maps lvl1_name → lvl1_code
export function lvl1NameToCode(name: string): string {
  return LVL1_OPTIONS.find(o => o.name === name)?.code ?? name;
}

// Maps lvl2_name → lvl2_code for a given lvl1_name (LVL2_OPTIONS uses names as keys)
export function lvl2NameToCode(lvl1Name: string, lvl2Name: string): string {
  const lvl2s = LVL2_OPTIONS[lvl1Name] ?? [];
  return lvl2s.find(o => o.name === lvl2Name)?.code ?? lvl2Name;
}

// Maps (lvl1_code, lvl2_code) → lvl2_name, using LVL1_OPTIONS + LVL2_OPTIONS
function lvl2CodeToName(lvl1Code: string | null, lvl2Code: string | null): string {
  if (!lvl1Code || !lvl2Code) return '';
  const lvl1Name = lvl1CodeToName(lvl1Code);
  const lvl2s = LVL2_OPTIONS[lvl1Name] ?? [];
  return lvl2s.find(o => o.code === lvl2Code)?.name ?? lvl2Code;
}

// All lvl1 options with code+name
export { LVL1_OPTIONS };

export default function ApprovalDetail({ proposal, onUpdate, onApprove, onReject, saving }: ApprovalDetailProps) {
  const isType1 = proposal.type === 'type1';
  const [useLlm, setUseLlm] = useState(isType1); // Type1 defaults to agree
  const [localLvl1Name, setLocalLvl1Name] = useState(() =>
    proposal.final_lvl1_code ? lvl1CodeToName(proposal.final_lvl1_code) : (isType1 && proposal.llm_lvl1_code ? lvl1CodeToName(proposal.llm_lvl1_code) : '')
  );
  const [localLvl2Name, setLocalLvl2Name] = useState(() =>
    proposal.final_lvl2_code
      ? lvl2CodeToName(proposal.final_lvl1_code || proposal.llm_lvl1_code, proposal.final_lvl2_code)
      : (isType1 && proposal.llm_lvl2_code
        ? lvl2CodeToName(proposal.llm_lvl1_code, proposal.llm_lvl2_code)
        : '')
  );
  const [localKeyword, setLocalKeyword] = useState(
    proposal.final_keyword ?? proposal.llm_keyword ?? ''
  );
  const [localMatchField, setLocalMatchField] = useState(
    proposal.final_match_field ?? proposal.llm_match_field ?? 'summary'
  );
  const [localMatchField2, setLocalMatchField2] = useState(
    proposal.final_match_field2 ?? proposal.llm_match_field2 ?? ''
  );
  const [localMatchValue2, setLocalMatchValue2] = useState(
    proposal.final_match_value2 ?? proposal.llm_match_value2 ?? ''
  );
  const [localNote, setLocalNote] = useState(proposal.user_note ?? '');

  const effectiveLvl1Name = useLlm && isType1 ? lvl1CodeToName(proposal.llm_lvl1_code) : localLvl1Name;
  const effectiveLvl2Name = useLlm && isType1 ? lvl2CodeToName(proposal.llm_lvl1_code, proposal.llm_lvl2_code) : localLvl2Name;
  const effectiveKeyword = useLlm && isType1 ? proposal.llm_keyword ?? '' : localKeyword;
  const effectiveMatchField = useLlm && isType1 ? (proposal.llm_match_field ?? 'summary') : localMatchField;
  const effectiveMatchField2 = useLlm && isType1 ? (proposal.llm_match_field2 ?? '') : localMatchField2;
  const effectiveMatchValue2 = useLlm && isType1 ? (proposal.llm_match_value2 ?? '') : localMatchValue2;

  const txnDir = txnDirection(proposal as any);
  const allowedLvl1 = allowedLvl1ByDirection(txnDir as any);
  const currentLvl2List = effectiveLvl1Name ? (LVL2_OPTIONS[effectiveLvl1Name] ?? []) : [];

  function applyLvl1(name: string) {
    setLocalLvl1Name(name);
    setLocalLvl2Name('');
    const code = lvl1NameToCode(name);
    const patch = { final_lvl1_code: code, final_lvl2_code: null, final_keyword: localKeyword, final_match_field: localMatchField };
    onUpdate(proposal.proposal_id, patch);
  }

  function applyLvl2(name: string) {
    setLocalLvl2Name(name);
    const lvl1Code = lvl1NameToCode(localLvl1Name);
    const lvl2Code = lvl2NameToCode(lvl1Code, name);
    const patch = { final_lvl1_code: lvl1Code, final_lvl2_code: lvl2Code, final_keyword: localKeyword, final_match_field: localMatchField };
    onUpdate(proposal.proposal_id, patch);
  }

  function applyKeyword(kw: string, mf: string) {
    setLocalKeyword(kw);
    setLocalMatchField(mf);
    const lvl1Code = lvl1NameToCode(localLvl1Name);
    const lvl2Code = localLvl2Name ? lvl2NameToCode(lvl1Code, localLvl2Name) : null;
    onUpdate(proposal.proposal_id, { final_lvl1_code: lvl1Code, final_lvl2_code: lvl2Code, final_keyword: kw, final_match_field: mf, final_match_field2: localMatchField2 || null, final_match_value2: localMatchValue2 || null });
  }

  function applyCondition2(mf2: string, newValue2: string) {
    setLocalMatchField2(mf2);
    setLocalMatchValue2(newValue2);
    const lvl1Code = lvl1NameToCode(localLvl1Name);
    const lvl2Code = localLvl2Name ? lvl2NameToCode(lvl1Code, localLvl2Name) : null;
    onUpdate(proposal.proposal_id, { final_lvl1_code: lvl1Code, final_lvl2_code: lvl2Code, final_keyword: localKeyword, final_match_field: localMatchField, final_match_field2: mf2 || null, final_match_value2: newValue2 || null });
  }

  const canApprove = isType1
    ? !!(proposal.llm_lvl1_code || localLvl1Name || effectiveLvl1Name)
    : !!(localLvl1Name);

  const isRejected = proposal.status === 'rejected';
  const isExecuted = proposal.status === 'executed';
  const isDone = isRejected || isExecuted;

  return (
    <div className="bg-slate-50 border-t border-gray-200 px-6 py-4 space-y-4">
      {/* Transaction full info */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div>
          <div className="text-xs text-gray-500">时间</div>
          <div>{proposal.txn_time ? new Date(proposal.txn_time).toLocaleString('zh-CN') : '-'}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">对方单位</div>
          <div>{proposal.counterparty_name || '-'}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">摘要</div>
          <div className="truncate max-w-[200px]" title={proposal.summary ?? ''}>{proposal.summary || '-'}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">金额</div>
          <div className={(proposal.in_amt ?? 0) > 0 ? 'text-green-600' : 'text-red-600'}>
            {(proposal.in_amt ?? 0) > 0
              ? `+¥${(proposal.in_amt ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`
              : `-¥${Math.abs(Number(proposal.out_amt || 0)).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`}
          </div>
        </div>
        {proposal.memo && (
          <div className="col-span-2">
            <div className="text-xs text-gray-500">附言</div>
            <div>{proposal.memo}</div>
          </div>
        )}
      </div>

      {/* LLM reasoning or missing fields */}
      {isType1 ? (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
          <div className="font-medium text-green-800 mb-1">LLM 推荐分类</div>
          <div className="text-green-700 mb-1">
            <span className="font-semibold">{lvl1CodeToName(proposal.llm_lvl1_code)}</span>
            {proposal.llm_lvl2_code && (
              <> / <span>{lvl2CodeToName(proposal.llm_lvl1_code, proposal.llm_lvl2_code)}</span></>
            )}
          </div>
          <div className="text-xs text-green-600">关键词: {proposal.llm_keyword || '-'}</div>
          <div className="text-xs text-green-600">匹配字段: {proposal.llm_match_field || '-'}</div>
          {proposal.llm_match_field2 && proposal.llm_match_value2 && (
            <div className="text-xs text-green-600">条件2: {proposal.llm_match_field2} 含 "{proposal.llm_match_value2}"</div>
          )}
          <div className="text-xs text-green-600">置信度: {proposal.llm_confidence || '-'}</div>
          {proposal.llm_reasoning && (
            <div className="mt-2 text-xs text-green-700 bg-green-100 rounded p-2">
              <strong>推理过程:</strong> {proposal.llm_reasoning}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm">
          <div className="font-medium text-yellow-800 mb-1">待补充信息</div>
          <div className="text-yellow-700 text-xs">
            缺少字段: {(proposal.llm_missing_fields || []).join(', ') || '无'}
          </div>
          {proposal.llm_reasoning && (
            <div className="mt-1 text-xs text-yellow-600">{proposal.llm_reasoning}</div>
          )}
        </div>
      )}

      {/* Decision form */}
      {!isDone && (
        <div className="space-y-3">
          {/* Agree/Customize toggle */}
          {isType1 && (
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={useLlm}
                  onChange={e => setUseLlm(e.target.checked)}
                  className="rounded"
                />
                <span className="font-medium text-gray-700">同意 LLM 推荐</span>
              </label>
              {useLlm && (
                <span className="text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded">
                  将使用: {lvl1CodeToName(proposal.llm_lvl1_code)} {proposal.llm_lvl2_code ? `/${lvl2CodeToName(proposal.llm_lvl1_code, proposal.llm_lvl2_code)}` : ''}
                </span>
              )}
              {!useLlm && (
                <span className="text-xs text-gray-500">自定义选择</span>
              )}
            </div>
          )}

          {/* Classification form */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">一级分类 *</label>
              <select
                value={effectiveLvl1Name}
                onChange={e => applyLvl1(e.target.value)}
                disabled={isDone}
                className="w-full border rounded px-2 py-1.5 text-sm bg-white disabled:bg-gray-100"
              >
                <option value="">选择分类</option>
                {allowedLvl1.map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">二级分类</label>
              <select
                value={effectiveLvl2Name}
                onChange={e => applyLvl2(e.target.value)}
                disabled={isDone || !effectiveLvl1Name || currentLvl2List.length === 0}
                className="w-full border rounded px-2 py-1.5 text-sm bg-white disabled:bg-gray-100"
              >
                <option value="">选择分类</option>
                {currentLvl2List.map(opt => (
                  <option key={opt.name} value={opt.name}>{opt.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">关键词</label>
              <input
                type="text"
                value={localKeyword}
                onChange={e => {
                  setLocalKeyword(e.target.value);
                  onUpdate(proposal.proposal_id, {
                    final_keyword: e.target.value,
                    final_match_field: localMatchField,
                    final_match_field2: localMatchField2 || null,
                    final_match_value2: localMatchValue2 || null
                  });
                }}
                disabled={isDone}
                placeholder="匹配关键词"
                className="w-full border rounded px-2 py-1.5 text-sm disabled:bg-gray-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">匹配字段</label>
              <select
                value={proposal.final_match_field ?? proposal.llm_match_field ?? 'summary'}
                onChange={e => {
                  setLocalMatchField(e.target.value);
                  onUpdate(proposal.proposal_id, {
                    final_keyword: localKeyword,
                    final_match_field: e.target.value,
                    final_match_field2: localMatchField2 || null,
                    final_match_value2: localMatchValue2 || null
                  });
                }}
                disabled={isDone}
                className="w-full border rounded px-2 py-1.5 text-sm bg-white disabled:bg-gray-100"
              >
                <option value="summary">摘要</option>
                <option value="memo">附言</option>
                <option value="purpose">用途</option>
                <option value="counterparty_name">对方单位</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">条件2字段</label>
              <select
                value={localMatchField2 || proposal.final_match_field2 ?? proposal.llm_match_field2 ?? ''}
                onChange={e => {
                  const field2 = e.target.value;
                  setLocalMatchField2(field2);
                  // Auto-fill keyword from the corresponding transaction field
                  const field2Value = field2 === 'summary' ? proposal.summary
                    : field2 === 'memo' ? proposal.memo
                    : field2 === 'purpose' ? (proposal as any).purpose
                    : field2 === 'counterparty_name' ? proposal.counterparty_name
                    : '';
                  setLocalMatchValue2(field2Value ?? '');
                  onUpdate(proposal.proposal_id, {
                    final_keyword: localKeyword,
                    final_match_field: localMatchField,
                    final_match_field2: field2 || null,
                    final_match_value2: field2Value || null
                  });
                }}
                disabled={isDone}
                className="w-full border rounded px-2 py-1.5 text-sm bg-white disabled:bg-gray-100"
              >
                <option value="">（无）</option>
                <option value="summary">摘要</option>
                <option value="memo">附言</option>
                <option value="purpose">用途</option>
                <option value="counterparty_name">对方单位</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">条件2关键词</label>
              <input
                type="text"
                value={localMatchValue2}
                onChange={e => {
                  setLocalMatchValue2(e.target.value);
                  onUpdate(proposal.proposal_id, {
                    final_keyword: localKeyword,
                    final_match_field: localMatchField,
                    final_match_field2: localMatchField2 || null,
                    final_match_value2: e.target.value || null
                  });
                }}
                disabled={isDone || !proposal.final_match_field2 && !proposal.llm_match_field2}
                placeholder="AND 第二条件"
                className="w-full border rounded px-2 py-1.5 text-sm disabled:bg-gray-100"
              />
            </div>
          </div>

          {/* User note */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">备注</label>
            <input
              type="text"
              value={localNote}
              onChange={e => setLocalNote(e.target.value)}
              disabled={isDone}
              placeholder="可选备注"
              className="w-full border rounded px-2 py-1.5 text-sm disabled:bg-gray-100"
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={() => onApprove(proposal.proposal_id)}
              disabled={saving || !canApprove || isDone}
              className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-40"
            >
              {saving ? '处理中...' : '批准此条'}
            </button>
            <button
              onClick={() => onReject(proposal.proposal_id)}
              disabled={saving || isDone}
              className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-40"
            >
              否决此条
            </button>
            {isExecuted && (
              <span className="text-xs text-green-600 bg-green-100 px-2 py-1 rounded">已批准</span>
            )}
            {isRejected && (
              <span className="text-xs text-red-600 bg-red-100 px-2 py-1 rounded">已否决</span>
            )}
          </div>
        </div>
      )}

      {isDone && (
        <div className="flex items-center gap-3">
          {isExecuted && (
            <span className="text-xs text-green-600 bg-green-100 px-2 py-1 rounded">已批准</span>
          )}
          {isRejected && (
            <span className="text-xs text-red-600 bg-red-100 px-2 py-1 rounded">已否决</span>
          )}
          {proposal.resolved_by && (
            <span className="text-xs text-gray-500">by {proposal.resolved_by}</span>
          )}
        </div>
      )}
    </div>
  );
}