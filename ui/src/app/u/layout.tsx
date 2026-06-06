import { ReactNode } from 'react';
import Link from 'next/link';
import { PageContextProvider } from '@/components/chat/PageContext';
import { ChatWidget } from '@/components/chat/ChatWidget';
import { getSessionUser } from '@/lib/auth-server';

export default async function ULayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  return (
    <PageContextProvider>
      {children}
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
