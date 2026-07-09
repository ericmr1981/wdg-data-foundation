import { ReactNode } from 'react';
import { PageContextProvider } from '@/components/chat/PageContext';
import { getSessionUser } from '@/lib/auth-server';
import styles from './layout.module.css';

export default async function ULayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  return (
    <PageContextProvider>
      <div className={styles.main}>
        {children}
      </div>
      {/* ⚙ 浮按钮 + ChatWidget 暂时隐藏:
          Phase 3 把 Agent 配置入口移到顶部"管理 ▼"菜单,
          chat widget 在当前业务里不再被使用。两者都禁掉但不删代码,
          以后想恢复取消注释就行。 */}
      {/* 构建版本号 — 在构建时由 next.config.js 注入 NEXT_PUBLIC_GIT_SHA */}
      <div className="fixed bottom-4 left-4 z-40 text-[10px] text-gray-400 select-none">
        {process.env.NEXT_PUBLIC_GIT_SHA || 'dev'}
      </div>
    </PageContextProvider>
  );
}
