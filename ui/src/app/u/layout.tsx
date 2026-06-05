import { ReactNode } from 'react';
import { PageContextProvider } from '@/components/chat/PageContext';
import { ChatWidget } from '@/components/chat/ChatWidget';

export default function ULayout({ children }: { children: ReactNode }) {
  return (
    <PageContextProvider>
      {children}
      <ChatWidget />
    </PageContextProvider>
  );
}
