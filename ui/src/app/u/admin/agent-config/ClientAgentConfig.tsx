'use client';
import { AgentConfigEditor } from '@/components/admin/AgentConfigEditor';
import { AgentConfigPreview } from '@/components/admin/AgentConfigPreview';
import type { AgentConfigParams } from '@/lib/chat/agent-config-store';

interface Props {
  initial: { agentMd: string; params: AgentConfigParams };
  defaultParams: AgentConfigParams;
}

export function ClientAgentConfig({ initial, defaultParams }: Props) {
  async function handleSave(data: { agentMd: string; params: AgentConfigParams }) {
    const res = await fetch('/api/admin/agent-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async function handleReset() {
    const res = await fetch('/api/admin/agent-config', { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // After reset, reload the page to reflect the default values.
    window.location.reload();
  }

  return (
    <>
      <AgentConfigEditor
        initial={initial}
        defaultParams={defaultParams}
        onSave={handleSave}
        onReset={handleReset}
      />
      <div className="px-6 pb-6">
        <AgentConfigPreview agentMd={initial.agentMd} />
      </div>
    </>
  );
}
