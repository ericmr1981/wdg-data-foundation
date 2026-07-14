import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth-server';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/u/admin');
  if (user.role !== 'admin') {
    return (
      <div className="m-8 rounded border border-red-200 bg-red-50 p-4 text-red-800">
        <h2 className="text-lg font-semibold">403 — 需要 admin 权限</h2>
        <p>当前角色：{user.role}。请联系管理员申请权限。</p>
      </div>
    );
  }
  return (
    <>
      <nav className="border-b border-gray-200 bg-gray-100 px-6 py-2 text-xs">
        <div className="mx-auto flex max-w-6xl gap-4">
          {/* Agent 配置: 已经从顶部主菜单的"管理 ▼"下拉进入,这里不再显示 */}
          <a href="/u/admin/skills" className="text-gray-700 hover:text-blue-600">Skill</a>
          <a href="/u/admin/tasks" className="text-gray-700 hover:text-blue-600">任务</a>
          <a href="/u/admin/cron" className="text-gray-700 hover:text-blue-600">Cron</a>
          <a href="/u/admin/tools" className="text-gray-700 hover:text-blue-600">工具</a>
          <a href="/u/admin/mcp-status" className="text-gray-700 hover:text-blue-600">MCP 状态</a>
        </div>
      </nav>
      {children}
    </>
  );
}
