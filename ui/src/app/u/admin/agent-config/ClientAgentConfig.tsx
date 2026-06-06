'use client';
import { AgentConfigEditor } from '@/components/admin/AgentConfigEditor';
import { AgentConfigPreview } from '@/components/admin/AgentConfigPreview';
import type { AgentConfigParams } from '@/lib/chat/agent-config-store';

interface Props {
  initial: {
    agentMd: string;
    params: AgentConfigParams;
    baseURL: string | null;
    apiKeyMasked: string | null;
    model: string;
  };
  defaultParams: AgentConfigParams;
}

export function ClientAgentConfig({ initial, defaultParams }: Props) {
  async function handleSave(data: {
    agentMd: string;
    params: AgentConfigParams;
    baseURL: string | null;
    apiKey: string;
    model: string;
  }) {
    // Note: apiKey '' means "keep current value" (server distinguishes via === '').
    // To CLEAR the apiKey the admin should click "重置默认" (which calls DELETE).
    const res = await fetch('/api/admin/agent-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentMd: data.agentMd,
        params: data.params,
        baseURL: data.baseURL,
        apiKey: data.apiKey,
        model: data.model,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // After save, reload to pick up masked apiKey from server (in case model changed)
    window.location.reload();
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
