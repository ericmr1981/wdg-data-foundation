import { ReactNode } from 'react';
import Link from 'next/link';
import { PageContextProvider } from '@/components/chat/PageContext';
import { ChatWidget } from '@/components/chat/ChatWidget';
import { getSessionUser } from '@/lib/auth-server';
import styles from './layout.module.css';

export default async function ULayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  return (
    <PageContextProvider>
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 flex gap-6 h-10 items-center text-sm">
          <Link href="/u" className="text-gray-700 hover:text-blue-600">首页</Link>
          <Link href="/u/dashboard" className="text-gray-700 hover:text-blue-600">经营看板</Link>
          <Link href="/u/financial" className="text-gray-700 hover:text-blue-600">财务</Link>
          <Link href="/u/sales" className="text-gray-700 hover:text-blue-600">销售</Link>
          <Link href="/u/store-report" className="text-gray-700 hover:text-blue-600">门店月报</Link>
          <Link href="/u/notifications" className="text-gray-700 hover:text-blue-600 font-semibold">
            通知
          </Link>
        </div>
      </div>
      <div className={styles.main}>
        {children}
      </div>
      {user?.role === 'admin' && (
        <Link
          href="/u/admin/agent-config"
          className="fixed bottom-24 right-8 z-40 flex h-10 w-10 items-center justify-center rounded-full bg-gray-700 text-white shadow-lg hover:bg-gray-800"
          title="Agent 配置 (Admin)"
        >
          ⚙
        </Link>
      )}
      <ChatWidget />
    </PageContextProvider>
  );
}
