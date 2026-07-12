'use client';
import { useState } from 'react';
import { AgentConfigEditor } from '@/components/admin/AgentConfigEditor';
import { AgentConfigPreview } from '@/components/admin/AgentConfigPreview';
import type { AgentConfigParams } from '@/lib/chat/agent-config-store';

interface McpBackend {
  name: string;
  url: string;
  transport?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

interface Props {
  initial: {
    agentMd: string;
    params: AgentConfigParams;
    baseURL: string | null;
    apiKeyMasked: string | null;
    model: string;
    jwksUrl: string | null;
    mcpBackends?: McpBackend[];
  };
  defaultParams: AgentConfigParams;
}

export function ClientAgentConfig({ initial, defaultParams }: Props) {
  const [saving, setSaving] = useState(false);

  async function handleSave(data: {
    agentMd: string;
    params: AgentConfigParams;
    baseURL: string | null;
    apiKey: string;
    model: string;
    jwksUrl: string | null;
    mcpBackends?: McpBackend[];
  }) {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/agent-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      window.location.reload();
    } catch (e) {
      alert('保存失败: ' + (e instanceof Error ? e.message : String(e)));
      setSaving(false);
    }
  }

  async function handleReset() {
    const res = await fetch('/api/admin/agent-config', { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
