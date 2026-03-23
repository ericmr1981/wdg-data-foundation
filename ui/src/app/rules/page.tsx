'use client';

import { useEffect, useState, useMemo } from 'react';
import { useBrand } from '@/lib/brand-context';
import type { BankRule } from '@/lib/types';

export default function RulesPage() {
  const { brand } = useBrand();
  const [rules, setRules] = useState<BankRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingRule, setEditingRule] = useState<BankRule | null>(null);
  const [formData, setFormData] = useState({
    priority: 1,
    direction: 'in',
    match_field: 'counterparty_name',
    match_value: '',
    lvl1: '',
    lvl2: '',
    enabled: true
  });

  // 文件重跑相关状态
  const [files, setFiles] = useState<{ id: number; file_name: string; store_code: string; month: string; status: string }[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<number[]>([]);
  const [rerunLoading, setRerunLoading] = useState(false);

  useEffect(() => {
    fetchRules();
    fetchFiles();
  }, [brand]);

  async function fetchRules() {
    try {
      setLoading(true);
      const res = await fetch(`/api/rules?brand=${brand}`);
      const data = await res.json();
      if (data.success) {
        setRules(data.data);
      } else {
        setError(data.error);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function fetchFiles() {
    try {
      const res = await fetch(`/api/rules/files?brand=${brand}&limit=20`);
      const data = await res.json();
      if (data.success) {
        setFiles(data.data || []);
      }
    } catch (err: any) {
      console.error('Failed to fetch files:', err);
    }
  }

  async function handleRerunMatch() {
    if (selectedFileIds.length === 0) {
      alert('请先选择要重跑的文件');
      return;
    }
    try {
      setRerunLoading(true);
      const res = await fetch('/api/pipeline/rerun-match-by-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, source_file_ids: selectedFileIds })
      });
      const data = await res.json();
      if (data.success) {
        alert(`重跑成功！已处理 ${selectedFileIds.length} 个文件`);
        setSelectedFileIds([]);
      } else {
        alert(`重跑失败: ${data.error}`);
      }
    } catch (err: any) {
      alert(`重跑失败: ${err.message}`);
    } finally {
      setRerunLoading(false);
    }
  }

  function toggleFileSelection(fileId: number) {
    setSelectedFileIds(prev =>
      prev.includes(fileId)
        ? prev.filter(id => id !== fileId)
        : [...prev, fileId]
    );
  }

  // Find duplicate rules (same match_field + match_value)
  const duplicateRuleIds = useMemo(() => {
    const seen = new Map<string, number>();
    const duplicates = new Set<number>();
    rules.forEach(rule => {
      const key = `${rule.match_field}:${rule.match_value}`;
      if (seen.has(key)) {
        duplicates.add(rule.rule_id);
        duplicates.add(seen.get(key)!);
      } else {
        seen.set(key, rule.rule_id);
      }
    });
    return duplicates;
  }, [rules]);

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

  async function handleDelete(rule_id: number) {
    if (!confirm('确定要删除这条规则吗？')) return;
    try {
      const res = await fetch(`/api/rules?id=${rule_id}&brand=${brand}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        fetchRules();
      } else {
        setError(data.error || '删除失败');
      }
    } catch (err: any) {
      setError(err.message);
    }
  }

  function resetForm() {
    setFormData({
      priority: 1,
      direction: 'in',
      match_field: 'counterparty_name',
      match_value: '',
      lvl1: '',
      lvl2: '',
      enabled: true
    });
  }

  function openEditModal(rule: BankRule) {
    setEditingRule(rule);
    setFormData({
      priority: rule.priority,
      direction: rule.direction,
      match_field: rule.match_field,
      match_value: rule.match_value,
      lvl1: rule.lvl1,
      lvl2: rule.lvl2 || '',
      enabled: rule.enabled
    });
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
        </div>
        <button
          onClick={() => { resetForm(); setEditingRule(null); setShowModal(true); }}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          + 新增规则
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          错误: {error}
        </div>
      )}

      {/* 按文件重跑匹配模块 */}
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">按文件重跑匹配（同步）</h2>
          <button
            onClick={handleRerunMatch}
            disabled={rerunLoading || selectedFileIds.length === 0}
            className={`px-4 py-2 rounded-lg text-white ${
              rerunLoading || selectedFileIds.length === 0
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-orange-600 hover:bg-orange-700'
            }`}
          >
            {rerunLoading ? '处理中...' : `重跑匹配 (${selectedFileIds.length})`}
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          选择需要重新执行分类匹配的文件（规则和 override 会重新生效）
        </p>
        {files.length === 0 ? (
          <p className="text-gray-500">暂无已完成的银行流水文件</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-y-auto">
            {files.map((file) => (
              <label
                key={file.id}
                className={`flex items-center p-2 border rounded cursor-pointer ${
                  selectedFileIds.includes(file.id) ? 'border-orange-500 bg-orange-50' : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedFileIds.includes(file.id)}
                  onChange={() => toggleFileSelection(file.id)}
                  className="mr-2"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">{file.file_name}</div>
                  <div className="text-xs text-gray-500">{file.store_code} · {file.month}</div>
                </div>
              </label>
            ))}
          </div>
        )}
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

      <div className="bg-white shadow rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">优先级</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">方向</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">匹配字段</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">关键词</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">分类</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">启用</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">操作</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {rules.map((rule) => (
              <tr key={rule.rule_id} className={`
                ${!rule.enabled ? 'bg-gray-50' : ''}
                ${duplicateRuleIds.has(rule.rule_id) ? 'bg-orange-50' : ''}
              `}>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                  <div className="flex items-center space-x-2">
                    <span>{rule.rule_id}</span>
                    {duplicateRuleIds.has(rule.rule_id) && (
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
                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{rule.match_value}</td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                  {rule.lvl1}{rule.lvl2 ? `-${rule.lvl2}` : ''}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-center">
                  <button
                    onClick={() => handleToggleEnabled(rule)}
                    className={`w-10 h-5 rounded-full transition-colors ${
                      rule.enabled ? 'bg-green-500' : 'bg-gray-300'
                    }`}
                  >
                    <span className={`block w-4 h-4 bg-white rounded-full transform transition-transform ${
                      rule.enabled ? 'translate-x-5' : 'translate-x-0.5'
                    }`} />
                  </button>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-right text-sm space-x-2">
                  <button onClick={() => openEditModal(rule)} className="text-blue-600 hover:text-blue-800">编辑</button>
                  <button onClick={() => handleDelete(rule.rule_id)} className="text-red-600 hover:text-red-800">删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rules.length === 0 && (
          <p className="text-center py-8 text-gray-500">暂无规则</p>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
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
                <label className="block text-sm font-medium text-gray-700">方向</label>
                <select
                  value={formData.direction}
                  onChange={(e) => setFormData({...formData, direction: e.target.value})}
                  className="mt-1 block w-full border rounded-md px-3 py-2"
                >
                  <option value="in">收入</option>
                  <option value="out">支出</option>
                  <option value="any">任意</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">匹配字段</label>
                <select
                  value={formData.match_field}
                  onChange={(e) => setFormData({...formData, match_field: e.target.value})}
                  className="mt-1 block w-full border rounded-md px-3 py-2"
                >
                  <option value="counterparty_name">对方单位</option>
                  <option value="summary">摘要</option>
                  <option value="memo">附言</option>
                  <option value="purpose">用途</option>
                  <option value="any">任意字段</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">关键词</label>
                <input
                  type="text"
                  value={formData.match_value}
                  onChange={(e) => setFormData({...formData, match_value: e.target.value})}
                  className="mt-1 block w-full border rounded-md px-3 py-2"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">一级分类</label>
                <input
                  type="text"
                  value={formData.lvl1}
                  onChange={(e) => setFormData({...formData, lvl1: e.target.value})}
                  className="mt-1 block w-full border rounded-md px-3 py-2"
                  placeholder="如：营业收入、运费、人力成本"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">二级分类（可选）</label>
                <input
                  type="text"
                  value={formData.lvl2}
                  onChange={(e) => setFormData({...formData, lvl2: e.target.value})}
                  className="mt-1 block w-full border rounded-md px-3 py-2"
                  placeholder="如：美团、顺丰"
                />
              </div>
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
      )}
    </div>
  );
}
