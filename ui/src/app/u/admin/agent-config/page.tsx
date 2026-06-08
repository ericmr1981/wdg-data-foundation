import { getAgentConfig, DEFAULT_PARAMS } from '@/lib/chat/agent-config-store';
import pool from '@/lib/db';
import { decrypt } from '@/lib/chat/secret-crypto';
import { ClientAgentConfig } from './ClientAgentConfig';

export const dynamic = 'force-dynamic';

async function loadInitialConfig() {
  const cfg = getAgentConfig();
  let baseURL = cfg.baseURL;
  let apiKeyMasked: string | null = null;
  let model = cfg.model;
  if (process.env.AGENT_CRED_ENCRYPTION_KEY) {
    try {
      const { rows } = await pool.query(
        'SELECT base_url, encrypted_api_key, model FROM ops.chat_agent_credentials WHERE id = 1',
      );
      if (rows.length > 0) {
        const row = rows[0];
        if (row.base_url) baseURL = row.base_url as string;
        if (row.encrypted_api_key) {
          const k = decrypt(row.encrypted_api_key as string, process.env.AGENT_CRED_ENCRYPTION_KEY);
          apiKeyMasked = maskKey(k);
        }
        if (row.model) model = row.model as string;
      }
    } catch (err) {
      console.warn('[admin/agent-config page] DB load failed:', (err as Error).message);
    }
  }
  return {
    agentMd: cfg.agentMd,
    params: cfg.params,
    baseURL,
    apiKeyMasked,
    model,
  };
}

function maskKey(k: string): string {
  if (k.length <= 8) return '***';
  return k.slice(0, 4) + '***' + k.slice(-4);
}

export default async function Page() {
  const initial = await loadInitialConfig();
  return (
    <div className="min-h-screen bg-gray-50">
      <AdminNav />
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-900">Agent 配置 (Admin)</h1>
        <p className="text-xs text-gray-500">编辑 agent.md 自定义提示词 · 调整调试参数 · 配置 Anthropic API · 变更热生效</p>
      </header>
      <main className="mx-auto max-w-5xl">
        <ClientAgentConfig initial={initial} defaultParams={DEFAULT_PARAMS} />
      </main>
    </div>
  );
}

function AdminNav() {
  return (
    <nav className="border-b border-gray-200 bg-gray-100 px-6 py-2 text-xs">
      <div className="mx-auto flex max-w-6xl gap-4">
        <a href="/u/admin/agent-config" className="text-gray-700 hover:text-blue-600">Agent 配置</a>
        <a href="/u/admin/skills" className="text-gray-700 hover:text-blue-600">Skill 管理</a>
        <a href="/u/admin/brands" className="text-gray-700 hover:text-blue-600">Brands</a>
        <a href="/u/admin/users" className="text-gray-700 hover:text-blue-600">Users</a>
      </div>
    </nav>
  );
}
