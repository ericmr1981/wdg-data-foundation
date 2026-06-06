import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth-server';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/u/admin/agent-config');
  if (user.role !== 'admin') {
    return (
      <div className="m-8 rounded border border-red-200 bg-red-50 p-4 text-red-800">
        <h2 className="text-lg font-semibold">403 — 需要 admin 权限</h2>
        <p>当前角色：{user.role}。请联系管理员申请权限。</p>
      </div>
    );
  }
  return <>{children}</>;
}
