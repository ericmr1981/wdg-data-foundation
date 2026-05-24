'use client';

import { useEffect, useState, useMemo } from 'react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type Lvl1Option = { lvl1_code: string; lvl1_name: string; direction: 'in'|'out'|'any' };
type Lvl2Option = { lvl2_code: string; lvl2_name: string };

import { useBrand } from '@/lib/brand-context';
import type { BankRule } from '@/lib/types';

function SortableRuleRow({
  rule,
  reorderMode,
  duplicate,
  lvl1Name,
  lvl2Name,
  onEdit,
  onDelete,
  onToggle,
}: {
  rule: any;
  reorderMode: boolean;
  duplicate: boolean;
  lvl1Name: string;
  lvl2Name: string | null;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rule.rule_id,
    disabled: !reorderMode,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={
        `${!rule.enabled ? 'bg-gray-50' : ''} ` +
        `${duplicate ? 'bg-orange-50' : ''}`
      }
    >
      {reorderMode && (
        <td className="px-3 py-3 text-sm text-gray-400">
          <span
            className="cursor-grab select-none"
            title="拖拽排序"
            {...attributes}
            {...listeners}
          >
            ⋮⋮
          </span>
        </td>
      )}
      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
        <div className="flex items-center space-x-2">
          <span>{rule.rule_id}</span>
          {duplicate && (
            <span className="px-1.5 py-0.5 text-xs bg-orange-100 text-orange-700 rounded">重复</span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{rule.priority}</td>
      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
        {rule.direction === 'in' ? '收入' : rule.direction === 'out' ? '支出' : '任意'}
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
        {rule.match_field === 'counterparty_name' ? '对方单位' :
         rule.match_field === 'summary' ? '摘要' :
         rule.match_field === 'memo' ? '附言' :
         rule.match_field === 'purpose' ? '用途' : rule.match_field}
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
        {rule.match_type === 'contains' ? '模糊匹配' :
         rule.match_type === 'exact' ? '精确匹配' :
         rule.match_type === 'regex' ? '正则匹配' : rule.match_type}
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{rule.match_value}</td>
      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
        {rule.match_field === 'counterparty_name'
          ? rule.match_value
          : rule.match_field2 === 'counterparty_name'
            ? (rule.match_value2 || '-')
            : '-'}
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
        <div className="text-sm text-gray-900">
          {lvl1Name}
          {rule.lvl2_code ? (
            <span className="text-gray-500">{' '}· {lvl2Name || rule.lvl2_code}</span>
          ) : null}
        </div>
        <div className="text-xs text-gray-400">{rule.lvl1_code}{rule.lvl2_code ? `/${rule.lvl2_code}` : ''}</div>
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">{rule.group_name || '-'}</td>
      <td className="px-4 py-3 whitespace-nowrap text-center">
        <button
          onClick={onToggle}
          className={`w-10 h-5 rounded-full transition-colors ${rule.enabled ? 'bg-green-500' : 'bg-gray-300'}`}
        >
          <span className={`block w-4 h-4 bg-white rounded-full transform transition-transform ${rule.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-right text-sm space-x-2">
        <button onClick={onEdit} className="text-blue-600 hover:text-blue-800">编辑</button>
        <button onClick={onDelete} className="text-red-600 hover:text-red-800">删除</button>
      </td>
    </tr>
  );
}

export default function RulesPage() {
  const { brand } = useBrand();
  const [rules, setRules] = useState<BankRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingRule, setEditingRule] = useState<BankRule | null>(null);

  // 导入规则（从其他品牌复制）
  const [showImportModal, setShowImportModal] = useState(false);
  const [importBrands, setImportBrands] = useState<Array<{ brand_code: string; brand_name: string }>>([]);
  const [importFrom, setImportFrom] = useState<string>('');
  const [importMode, setImportMode] = useState<'merge' | 'append'>('merge');
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // 删除确认 Modal（避免被浏览器禁用 confirm 弹窗）
  const [deleteRuleId, setDeleteRuleId] = useState<number | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // 分类字典（来自 DB）
  const [lvl1Options, setLvl1Options] = useState<Lvl1Option[]>([]);
  const [lvl2ByLvl1, setLvl2ByLvl1] = useState<Record<string, Lvl2Option[]>>({});

  // 搜索/筛选
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchLvl1, setSearchLvl1] = useState('');
  const [searchDirection, setSearchDirection] = useState('');
  const [searchGroup, setSearchGroup] = useState('');

  // 分组字典（来自 DB，可用于过滤/输入提示）
  const [ruleGroups, setRuleGroups] = useState<Array<{ group_name: string; sort_order: number }>>([]);

  const [formData, setFormData] = useState({
    priority: 1000,
    direction: 'in',
    match_field: 'summary',
    match_type: 'contains',
    match_value: '',
    match_field2: '' as string | '',
    match_value2: '' as string | '',
    lvl1_code: '',
    lvl2_code: '',
    group_name: '',
    enabled: true
  });

  // 命中预览（与 match 页一致）
  const [previewData, setPreviewData] = useState<{
    match_value: string;
    hit_count: number;
    total_amt: number;
    primary_lvl1: string | null;
    lvl1_distribution: Record<string, number>;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const allowedLvl1Options = useMemo(() => {
    const dir = formData.direction as 'in'|'out'|'any';
    if (!dir || dir === 'any') return lvl1Options;
    return lvl1Options.filter(o => o.direction === dir || o.direction === 'any');
  }, [lvl1Options, formData.direction]);
  const [rerunLoading, setRerunLoading] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
  const [reorderIds, setReorderIds] = useState<number[]>([]);
  const [reorderSaving, setReorderSaving] = useState(false);

  useEffect(() => {
    fetchCategories();
    fetchRuleGroups();
    fetchRules();
    fetchImportBrands();
  }, [brand]);

  async function fetchCategories() {
    try {
      const res = await fetch(`/api/categories?brand=${brand}`);
      const data = await res.json();
      if (data.success) {
        setLvl1Options(data.data.lvl1 || []);
        setLvl2ByLvl1(data.data.lvl2ByLvl1 || {});
      }
    } catch (err) {
      console.error('Failed to fetch categories:', err);
    }
  }

  async function fetchRuleGroups() {
    try {
      const res = await fetch(`/api/rule-groups?brand=${brand}`);
      const data = await res.json();
      if (data.success) {
        setRuleGroups(data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch rule groups:', err);
    }
  }

  async function fetchImportBrands() {
    try {
      const res = await fetch('/api/brands');
      const data = await res.json();
      if (data.success) {
        setImportBrands(data.data || []);
        // 默认 source 选一个不是当前 brand 的
        const first = (data.data || []).find((b: any) => b.brand_code !== brand);
        setImportFrom(first?.brand_code || '');
      }
    } catch (err) {
      // ignore
    }
  }

  async function fetchRules() {
    try {
      setLoading(true);
      const res = await fetch(`/api/rules?brand=${brand}`);
      const data = await res.json();
      if (data.success) {
        // pg bigint 可能会被序列化成 string，这里做一次归一化，避免按钮事件里类型异常
        const normalized = (data.data || []).map((r: any) => ({
          ...r,
          rule_id: Number(r.rule_id),
          priority: Number(r.priority),
          enabled: Boolean(r.enabled)
        }));
        setRules(normalized);
      } else {
        setError(data.error);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

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


  async function handleRerunMatch() {
    try {
      setRerunLoading(true);
      const res = await fetch('/api/pipeline/rerun-match-by-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, all_files: true })
      });
      const data = await res.json();
      if (data.success) {
        const processed = data?.data?.processed ?? '全部';
        alert(`重跑成功！已处理 ${processed} 个文件`);
      } else {
        alert(`重跑失败: ${data.error}`);
      }
    } catch (err: any) {
      alert(`重跑失败: ${err.message}`);
    } finally {
      setRerunLoading(false);
    }
  }


  // 搜索筛选逻辑
  const filteredRules = useMemo(() => {
    return rules.filter(rule => {
      // 关键词筛选（match_value）
      if (searchKeyword && !rule.match_value.toLowerCase().includes(searchKeyword.toLowerCase())) {
        return false;
      }
      // 分类筛选（lvl1_code）
      if (searchLvl1 && rule.lvl1_code !== searchLvl1) {
        return false;
      }
      // 方向筛选
      if (searchDirection && rule.direction !== searchDirection) {
        return false;
      }
      // 分组筛选
      if (searchGroup && String((rule as any).group_name || '') !== searchGroup) {
        return false;
      }
      return true;
    });
  }, [rules, searchKeyword, searchLvl1, searchDirection, searchGroup]);

  const lvl1NameByCode = useMemo(() => {
    const m = new Map<string, string>();
    lvl1Options.forEach(o => m.set(o.lvl1_code, o.lvl1_name));
    return m;
  }, [lvl1Options]);

  const lvl2NameByCode = useMemo(() => {
    const m = new Map<string, string>();
    Object.entries(lvl2ByLvl1).forEach(([lvl1, arr]) => {
      (arr || []).forEach(o => m.set(`${lvl1}:${o.lvl2_code}`, o.lvl2_name));
    });
    return m;
  }, [lvl2ByLvl1]);

  // Find duplicate rules (same match_field + match_value)
  const duplicateRuleIds = useMemo(() => {
    const seen = new Map<string, number>();
    const duplicates = new Set<number>();
    filteredRules.forEach(rule => {
      const key = `${rule.match_field}:${rule.match_value}`;
      if (seen.has(key)) {
        duplicates.add(rule.rule_id);
        duplicates.add(seen.get(key)!);
      } else {
        seen.set(key, rule.rule_id);
      }
    });
    return duplicates;
  }, [filteredRules]);

  // reorder list: use reorderIds order when enabled
  const reorderedRules = useMemo(() => {
    if (!reorderMode) return filteredRules;
    const map = new Map<number, BankRule>();
    filteredRules.forEach(r => map.set(r.rule_id, r));
    const ordered = reorderIds.map(id => map.get(id)).filter(Boolean) as BankRule[];
    // append any new ones not in list (e.g. after create)
    const rest = filteredRules.filter(r => !reorderIds.includes(r.rule_id));
    return [...ordered, ...rest];
  }, [reorderMode, filteredRules, reorderIds]);

  useEffect(() => {
    if (!reorderMode) return;
    setReorderIds(filteredRules.map(r => r.rule_id));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reorderMode]);

  async function saveReorder() {
    try {
      setReorderSaving(true);
      const res = await fetch('/api/rules/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, ordered_rule_ids: reorderIds, base_priority: 1000, step: 10 }),
      });
      const data = await res.json();
      if (!data.success) {
        alert(`保存失败: ${data.error}`);
        return;
      }
      // 体验：先退出拖拽模式，让页面“立刻返回”；再后台刷新列表
      setReorderMode(false);
      setReorderIds([]);
      fetchRules();
      alert('优先级顺序已保存');
    } catch (e: any) {
      alert(`保存失败: ${e.message}`);
    } finally {
      setReorderSaving(false);
    }
  }


  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const url = editingRule ? '/api/rules' : '/api/rules';
      const method = editingRule ? 'PUT' : 'POST';
      const body = editingRule
        ? { ...formData, rule_id: editingRule.rule_id, brand }
        : { ...formData, brand };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();

      if (data.success) {
        setShowModal(false);
        setEditingRule(null);
        resetForm();
        fetchRules();
      } else {
        setError(data.error);
      }
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleToggleEnabled(rule: BankRule) {
    try {
      const res = await fetch('/api/rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, rule_id: rule.rule_id, enabled: !rule.enabled })
      });
      const data = await res.json();
      if (data.success) {
        fetchRules();
      }
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteRuleId) return;
    try {
      setDeleteLoading(true);
      // hard delete (admin only)
      const res = await fetch(`/api/rules?id=${deleteRuleId}&brand=${brand}&hard=true`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setDeleteRuleId(null);
        fetchRules();
      } else {
        setError(data.error || '删除失败');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeleteLoading(false);
    }
  }

  function resetForm() {
    setFormData({
      priority: 1000,
      direction: 'in',
      match_field: 'summary',
      match_type: 'contains',
      match_value: '',
      match_field2: '',
      match_value2: '',
      lvl1_code: '',
      lvl2_code: '',
      group_name: '',
      enabled: true
    });
    setPreviewData(null);
  }

  function openEditModal(rule: BankRule) {
    setEditingRule(rule);
    setFormData({
      priority: rule.priority,
      direction: rule.direction,
      match_field: rule.match_field,
      match_type: rule.match_type || 'contains',
      match_value: rule.match_value,
      match_field2: (rule.match_field2 as any) || '',
      match_value2: (rule.match_value2 as any) || '',
      lvl1_code: rule.lvl1_code,
      lvl2_code: rule.lvl2_code || '',
      group_name: (rule as any).group_name || '',
      enabled: rule.enabled
    });

    // 打开时同步拉一次命中预览（与 match 页体验一致）
    if (rule.match_value && String(rule.match_value).length >= 3) {
      fetchPreview(rule.match_value);
    } else {
      setPreviewData(null);
    }

    setShowModal(true);
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="text-gray-500">加载中...</div></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <h1 className="text-2xl font-bold text-gray-900">规则管理</h1>
          <span className="text-sm text-gray-500">
            当前品牌: {brand === 'yufeng' ? '榆枫与山' : brand === 'bonjur' ? '本就' : brand}
          </span>
          {reorderMode && (
            <span className="text-xs text-orange-600">拖拽排序模式：拖动行 → 保存将批量重写 priority</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!reorderMode ? (
            <button
              onClick={() => {
                if (searchKeyword || searchLvl1 || searchDirection || searchGroup) {
                  alert('请先清除筛选后再排序（避免只排序子集造成误解）');
                  return;
                }
                setReorderMode(true);
                setReorderIds(filteredRules.map(r => r.rule_id));
              }}
              className="px-3 py-2 border rounded-lg bg-white hover:bg-gray-50"
            >
              拖拽排序
            </button>
          ) : (
            <>
              <button
                onClick={saveReorder}
                disabled={reorderSaving}
                className="px-3 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50"
              >
                {reorderSaving ? '保存中...' : '保存顺序'}
              </button>
              <button
                onClick={() => setReorderMode(false)}
                disabled={reorderSaving}
                className="px-3 py-2 border rounded-lg bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                取消
              </button>
            </>
          )}

          <button
            onClick={() => {
              setImportError(null);
              setShowImportModal(true);
            }}
            className="px-3 py-2 border rounded-lg bg-white hover:bg-gray-50"
          >
            导入规则
          </button>

          <button
            onClick={() => { resetForm(); setEditingRule(null); setShowModal(true); }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            + 新增规则
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          错误: {error}
        </div>
      )}

      {/* 重跑匹配模块 */}
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-gray-900">重跑匹配（该品牌全部文件）</h2>
          <button
            onClick={handleRerunMatch}
            disabled={rerunLoading}
            className={`px-4 py-2 rounded-lg text-white ${
              rerunLoading ? 'bg-gray-400 cursor-not-allowed' : 'bg-orange-600 hover:bg-orange-700'
            }`}
          >
            {rerunLoading ? '处理中...' : '重跑匹配'}
          </button>
        </div>
        <p className="text-sm text-gray-500">
          不再展示文件列表（文件多会很乱）。点击按钮将对当前品牌的所有成功银行文件记录一次“重跑事件”。
        </p>
      </div>

      {/* 重复规则提示 */}
      {duplicateRuleIds.size > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center">
            <span className="text-yellow-600 mr-2">⚠️</span>
            <span className="text-yellow-800 font-medium">发现 {duplicateRuleIds.size} 条重复规则</span>
          </div>
          <p className="text-sm text-yellow-700 mt-1">
            以下表格中带有橙色标记的规则存在相同的 match_field + match_value 组合，请检查并合并。
          </p>
        </div>
      )}

      {/* 搜索/筛选 */}
      <div className="bg-white shadow rounded-lg p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">关键词</label>
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="匹配关键词"
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">一级分类</label>
            <select
              value={searchLvl1}
              onChange={(e) => setSearchLvl1(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm"
            >
              <option value="">全部</option>
              {lvl1Options.map(opt => (
                <option key={opt.lvl1_code} value={opt.lvl1_code}>
                  {opt.lvl1_name}（{opt.lvl1_code}）
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">方向</label>
            <select
              value={searchDirection}
              onChange={(e) => setSearchDirection(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm"
            >
              <option value="">全部</option>
              <option value="in">收入</option>
              <option value="out">支出</option>
              <option value="any">任意</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">分组</label>
            <select
              value={searchGroup}
              onChange={(e) => setSearchGroup(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm"
            >
              <option value="">全部</option>
              {ruleGroups.map(g => (
                <option key={g.group_name} value={g.group_name}>{g.group_name}</option>
              ))}
            </select>
          </div>
        </div>
        {(searchKeyword || searchLvl1 || searchDirection || searchGroup) && (
          <div className="mt-3 flex items-center justify-between">
            <span className="text-sm text-gray-500">
              筛选结果：{filteredRules.length} / {rules.length} 条
            </span>
            <button
              onClick={() => { setSearchKeyword(''); setSearchLvl1(''); setSearchDirection(''); setSearchGroup(''); }}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              清除筛选
            </button>
          </div>
        )}
      </div>

      <div className="bg-white shadow rounded-lg overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {reorderMode && (
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">拖拽</th>
              )}
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">优先级</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">方向</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">匹配字段</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">匹配模式</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">关键词</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">对方单位</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">分类</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">分组</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">启用</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">操作</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {reorderMode ? (
              <DndContext
                collisionDetection={closestCenter}
                onDragEnd={(event) => {
                  const { active, over } = event;
                  if (!over) return;
                  if (active.id === over.id) return;
                  const oldIndex = reorderIds.indexOf(Number(active.id));
                  const newIndex = reorderIds.indexOf(Number(over.id));
                  if (oldIndex === -1 || newIndex === -1) return;
                  setReorderIds((items) => arrayMove(items, oldIndex, newIndex));
                }}
              >
                <SortableContext items={reorderIds} strategy={verticalListSortingStrategy}>
                  {reorderedRules.map((rule) => (
                    <SortableRuleRow
                      key={rule.rule_id}
                      rule={rule}
                      reorderMode
                      duplicate={duplicateRuleIds.has(rule.rule_id)}
                      lvl1Name={lvl1NameByCode.get(rule.lvl1_code) || rule.lvl1_code}
                      lvl2Name={rule.lvl2_code ? (lvl2NameByCode.get(`${rule.lvl1_code}:${rule.lvl2_code}`) || rule.lvl2_code) : null}
                      onEdit={() => openEditModal(rule)}
                      onDelete={() => setDeleteRuleId(rule.rule_id)}
                      onToggle={() => handleToggleEnabled(rule)}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            ) : (
              reorderedRules.map((rule) => (
                <SortableRuleRow
                  key={rule.rule_id}
                  rule={rule}
                  reorderMode={false}
                  duplicate={duplicateRuleIds.has(rule.rule_id)}
                  lvl1Name={lvl1NameByCode.get(rule.lvl1_code) || rule.lvl1_code}
                  lvl2Name={rule.lvl2_code ? (lvl2NameByCode.get(`${rule.lvl1_code}:${rule.lvl2_code}`) || rule.lvl2_code) : null}
                  onEdit={() => openEditModal(rule)}
                  onDelete={() => setDeleteRuleId(rule.rule_id)}
                  onToggle={() => handleToggleEnabled(rule)}
                />
              ))
            )}
          </tbody>
        </table>
        {rules.length === 0 && (
          <p className="text-center py-8 text-gray-500">暂无规则</p>
        )}
      </div>

      {/* 删除确认 Modal */}
      {deleteRuleId !== null && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-2">确认删除规则？</h2>
            <p className="text-sm text-gray-600 mb-4">rule_id: {deleteRuleId}</p>
            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setDeleteRuleId(null)}
                disabled={deleteLoading}
                className="px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                disabled={deleteLoading}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleteLoading ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 导入规则 Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-2">从其他品牌导入规则</h2>
            <div className="text-sm text-gray-600 mb-4">目标品牌：{brand}</div>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">来源品牌</label>
                <select
                  className="mt-1 block w-full border rounded-md px-3 py-2"
                  value={importFrom}
                  onChange={(e) => setImportFrom(e.target.value)}
                >
                  <option value="">请选择</option>
                  {importBrands
                    .filter((b) => b.brand_code !== brand)
                    .map((b) => (
                      <option key={b.brand_code} value={b.brand_code}>{b.brand_name}（{b.brand_code}）</option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">模式</label>
                <select
                  className="mt-1 block w-full border rounded-md px-3 py-2"
                  value={importMode}
                  onChange={(e) => setImportMode(e.target.value as any)}
                >
                  <option value="merge">merge（去重导入，不覆盖现有）</option>
                  <option value="append">append（全量追加，可能产生重复）</option>
                </select>
              </div>

              {importError && (
                <div className="text-sm text-red-600">{importError}</div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                  disabled={importLoading}
                  onClick={() => setShowImportModal(false)}
                >
                  取消
                </button>
                <button
                  className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50"
                  disabled={importLoading || !importFrom}
                  onClick={async () => {
                    if (!importFrom) return;
                    if (!confirm(`确认从 ${importFrom} 导入规则到 ${brand}？`)) return;
                    setImportLoading(true);
                    setImportError(null);
                    try {
                      const res = await fetch('/api/admin/rules/import-from-brand', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ from_brand: importFrom, to_brand: brand, mode: importMode }),
                      });
                      const data = await res.json();
                      if (!data.success) {
                        const extra = data.code ? ` (${data.code})` : '';
                        throw new Error((data.error || '导入失败') + extra);
                      }
                      await fetchRuleGroups();
                      await fetchRules();
                      alert(`导入完成：新增 ${data.data?.inserted ?? 0} 条规则`);
                      setShowImportModal(false);
                    } catch (e: any) {
                      setImportError(e.message);
                    } finally {
                      setImportLoading(false);
                    }
                  }}
                >
                  {importLoading ? '导入中...' : '开始导入'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 编辑/新增 Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 overflow-y-auto">
          <div className="min-h-full flex items-start justify-center p-4">
            <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto overscroll-contain">
            <h2 className="text-lg font-semibold mb-4">{editingRule ? '编辑规则' : '新增规则'}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">优先级</label>
                <input
                  type="number"
                  value={formData.priority}
                  onChange={(e) => setFormData({...formData, priority: parseInt(e.target.value)})}
                  className="mt-1 block w-full border rounded-md px-3 py-2"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">分组（可选）</label>
                <input
                  type="text"
                  list="wdg-rule-groups"
                  value={(formData as any).group_name || ''}
                  onChange={(e) => setFormData({ ...(formData as any), group_name: e.target.value })}
                  placeholder="例如：基础规则 / 门店特例 / 临时"
                  className="mt-1 block w-full border rounded-md px-3 py-2"
                />
                <datalist id="wdg-rule-groups">
                  {ruleGroups.map(g => (
                    <option key={g.group_name} value={g.group_name} />
                  ))}
                </datalist>
                <p className="text-xs text-gray-500 mt-1">分组目前主要用于管理/过滤（不影响匹配逻辑）；建议同一品牌内复用统一命名。</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">方向</label>
                <select
                  value={formData.direction}
                  onChange={(e) => {
                    const direction = e.target.value;
                    setFormData(prev => {
                      // 若切换方向后当前 lvl1 不合法，则清空 lvl1/lvl2
                      const allowed = direction === 'any'
                        ? true
                        : lvl1Options.some(o => (o.direction === direction || o.direction === 'any') && o.lvl1_code === prev.lvl1_code);
                      return {
                        ...prev,
                        direction,
                        lvl1_code: allowed ? prev.lvl1_code : '',
                        lvl2_code: allowed ? prev.lvl2_code : ''
                      };
                    });
                  }}
                  className="mt-1 block w-full border rounded-md px-3 py-2"
                >
                  <option value="in">收入</option>
                  <option value="out">支出</option>
                  <option value="any">任意</option>
                </select>
              </div>

              {/* 分类选择（对齐 match 页沉淀窗口） */}
              <div>
                <label className="block text-sm font-medium text-gray-700">一级分类 *</label>
                <select
                  value={formData.lvl1_code}
                  onChange={(e) => {
                    const lvl1_code = e.target.value;
                    setFormData({ ...formData, lvl1_code, lvl2_code: '' });
                  }}
                  className="mt-1 block w-full border rounded-md px-3 py-2"
                  required
                >
                  <option value="">选择分类</option>
                  {allowedLvl1Options.map(opt => (
                    <option key={opt.lvl1_code} value={opt.lvl1_code}>{opt.lvl1_name}</option>
                  ))}
                </select>
              </div>
              {formData.lvl1_code && (lvl2ByLvl1[formData.lvl1_code] || []).length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">二级分类</label>
                  <select
                    value={formData.lvl2_code}
                    onChange={(e) => setFormData({ ...formData, lvl2_code: e.target.value })}
                    className="mt-1 block w-full border rounded-md px-3 py-2"
                  >
                    <option value="">选择分类</option>
                    {(lvl2ByLvl1[formData.lvl1_code] || []).map(opt => (
                      <option key={opt.lvl2_code} value={opt.lvl2_code}>{opt.lvl2_name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700">匹配字段</label>
                <select
                  value={formData.match_field}
                  onChange={(e) => {
                    const v = e.target.value;
                    // match_type 规则：摘要/附言/用途固定 contains；对方单位默认 exact（可在后续迭代开放 contains）
                    const mt = v === 'counterparty_name' ? 'exact' : 'contains';
                    setFormData({ ...formData, match_field: v, match_type: mt });
                  }}
                  className="mt-1 block w-full border rounded-md px-3 py-2"
                >
                  <option value="summary">摘要</option>
                  <option value="memo">附言</option>
                  <option value="purpose">用途</option>
                  <option value="counterparty_name">对方单位（兜底）</option>
                </select>
              </div>

              {/* 匹配模式（与 match 页一致） */}
              <div>
                <label className="block text-sm font-medium text-gray-700">匹配模式</label>
                <div className="mt-1 flex items-center space-x-3">
                  <label className="flex items-center text-sm">
                    <input
                      type="radio"
                      checked={formData.match_type === 'contains'}
                      onChange={() => setFormData({ ...formData, match_type: 'contains' })}
                      className="mr-2"
                      disabled={formData.match_field === 'counterparty_name'}
                    />
                    模糊匹配（contains）
                  </label>
                  <label className="flex items-center text-sm">
                    <input
                      type="radio"
                      checked={formData.match_type === 'exact'}
                      onChange={() => setFormData({ ...formData, match_type: 'exact' })}
                      className="mr-2"
                      disabled={formData.match_field !== 'counterparty_name'}
                    />
                    精确匹配（exact）
                  </label>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {formData.match_field === 'counterparty_name'
                    ? '对方单位目前仅支持精确匹配'
                    : '摘要/附言/用途目前仅支持 contains（与分类函数一致）'}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">关键词</label>
                <input
                  type="text"
                  value={formData.match_value}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFormData({ ...formData, match_value: v });
                    if (v.length >= 3) fetchPreview(v);
                    else setPreviewData(null);
                  }}
                  className="mt-1 block w-full border rounded-md px-3 py-2"
                  required
                />
              </div>

              {/* 双重匹配：对方单位（counterparty_name） */}
              {formData.match_field !== 'counterparty_name' && (
                <div className="space-y-2">
                  <label className="flex items-center space-x-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={formData.match_field2 === 'counterparty_name'}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setFormData(prev => ({
                          ...prev,
                          match_field2: checked ? 'counterparty_name' : '',
                          match_value2: checked ? (prev.match_value2 || '') : ''
                        }));
                      }}
                      className="rounded"
                    />
                    <span>同时匹配对方单位（双重匹配）</span>
                  </label>

                  {formData.match_field2 === 'counterparty_name' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">对方单位</label>
                      <input
                        type="text"
                        value={formData.match_value2}
                        onChange={(e) => setFormData({ ...formData, match_value2: e.target.value })}
                        className="mt-1 block w-full border rounded-md px-3 py-2"
                        placeholder="输入完整对方单位名（exact）"
                      />
                      <p className="text-xs text-gray-500 mt-1">用于解决“同一关键词不同分类”的冲突：摘要命中且对方单位命中才生效</p>
                    </div>
                  )}
                </div>
              )}

              {/* 命中预览（与 match 页一致） */}
              {formData.match_value.length >= 3 && (
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
                          {Object.keys(previewData.lvl1_distribution || {}).length > 0 && (
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

              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.enabled}
                  onChange={(e) => setFormData({...formData, enabled: e.target.checked})}
                  className="mr-2"
                />
                <span className="text-sm text-gray-700">启用</span>
              </div>
              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setEditingRule(null); }}
                  className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  保存
                </button>
              </div>
            </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
