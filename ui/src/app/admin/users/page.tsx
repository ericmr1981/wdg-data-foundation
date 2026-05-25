'use client';

import { useEffect, useState } from 'react';

interface UserRow {
  user_id: string;
  username: string;
  role: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [formData, setFormData] = useState({ username: '', password: '', role: 'operator' });
  const [saving, setSaving] = useState(false);
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => { fetchUsers(); }, []);

  async function fetchUsers() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/users');
      const json = await res.json();
      if (json.success) setUsers(json.data);
      else setError(json.error);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function openCreateModal() {
    setEditingUser(null);
    setFormData({ username: '', password: '', role: 'operator' });
    setShowModal(true);
  }

  function openEditModal(user: UserRow) {
    setEditingUser(user);
    setFormData({ username: user.username, password: '', role: user.role });
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const url = '/api/admin/users';
      const method = editingUser ? 'PUT' : 'POST';
      const body: any = { username: formData.username, role: formData.role };
      if (editingUser) {
        body.user_id = editingUser.user_id;
        if (formData.password) body.password = formData.password;
      } else {
        body.password = formData.password;
      }
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        fetchUsers();
      } else {
        setError(json.error);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleEnabled(user: UserRow) {
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.user_id, enabled: !user.enabled }),
      });
      const json = await res.json();
      if (json.success) fetchUsers();
      else setError(json.error);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteUserId) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/admin/users?id=${deleteUserId}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        setDeleteUserId(null);
        fetchUsers();
      } else {
        setError(json.error);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeleteLoading(false);
    }
  }

  const formatDt = (d: string) => {
    if (!d) return '-';
    return new Date(d).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">账号管理</h1>
        <button onClick={openCreateModal} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          + 新增账号
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">错误: {error}</div>
      )}

      <div className="bg-white shadow rounded-lg overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">用户名</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">角色</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">状态</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">创建时间</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">操作</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {users.map(u => (
              <tr key={u.user_id} className={!u.enabled ? 'bg-gray-50' : ''}>
                <td className="px-4 py-3 text-sm font-medium text-gray-900">{u.username}</td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${u.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'}`}>
                    {u.role === 'admin' ? '管理员' : '操作员'}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => handleToggleEnabled(u)}
                    className={`w-10 h-5 rounded-full transition-colors ${u.enabled ? 'bg-green-500' : 'bg-gray-300'}`}>
                    <span className={`block w-4 h-4 bg-white rounded-full transform transition-transform ${u.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">{formatDt(u.created_at)}</td>
                <td className="px-4 py-3 text-right text-sm space-x-2">
                  <button onClick={() => openEditModal(u)} className="text-blue-600 hover:text-blue-800">编辑</button>
                  <button onClick={() => setDeleteUserId(u.user_id)} className="text-red-600 hover:text-red-800">删除</button>
                </td>
              </tr>
            ))}
            {users.length === 0 && !loading && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">暂无用户</td></tr>
            )}
          </tbody>
        </table>
        {loading && <div className="text-center py-4 text-gray-500">加载中...</div>}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 overflow-y-auto">
          <div className="min-h-full flex items-start justify-center p-4">
            <div className="bg-white rounded-lg p-6 w-full max-w-md mt-20">
              <h2 className="text-lg font-semibold mb-4">{editingUser ? '编辑账号' : '新增账号'}</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">用户名</label>
                  <input type="text" value={formData.username} onChange={e => setFormData({...formData, username: e.target.value})}
                    className="mt-1 block w-full border rounded-md px-3 py-2" required />
                </div>
                {!editingUser && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700">密码</label>
                    <input type="password" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})}
                      className="mt-1 block w-full border rounded-md px-3 py-2" required minLength={6} />
                  </div>
                )}
                {editingUser && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700">重置密码（留空不修改）</label>
                    <input type="password" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})}
                      className="mt-1 block w-full border rounded-md px-3 py-2" minLength={6} placeholder="输入新密码" />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700">角色</label>
                  <select value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})}
                    className="mt-1 block w-full border rounded-md px-3 py-2">
                    <option value="operator">操作员 (operator)</option>
                    <option value="admin">管理员 (admin)</option>
                  </select>
                </div>
                <div className="flex justify-end space-x-3 pt-2">
                  <button type="button" onClick={() => { setShowModal(false); setEditingUser(null); }}
                    className="px-4 py-2 border rounded-lg hover:bg-gray-50">取消</button>
                  <button type="submit" disabled={saving}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                    {saving ? '保存中...' : '保存'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {deleteUserId !== null && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-2">确认删除账号？</h2>
            <p className="text-sm text-gray-600 mb-4">此操作不可撤销。</p>
            <div className="flex justify-end space-x-3">
              <button type="button" onClick={() => setDeleteUserId(null)} disabled={deleteLoading}
                className="px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50">取消</button>
              <button type="button" onClick={handleDeleteConfirm} disabled={deleteLoading}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                {deleteLoading ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
