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
      {/* 构建版本号 — 在构建时由 next.config.js 注入 NEXT_PUBLIC_GIT_SHA */}
      <div className="fixed bottom-4 left-4 z-40 text-[10px] text-gray-400 select-none">
        {process.env.NEXT_PUBLIC_GIT_SHA || 'dev'}
      </div>
    </PageContextProvider>
  );
}
