// ui/src/app/u/admin/skills/page.tsx
// Server Component: fetch skill list from agent, render table + global controls
import { ClientSkillList } from './ClientSkillList';

export const dynamic = 'force-dynamic';

interface SkillSummary {
  name: string;
  description: string;
  triggers: string[];
  filename: string;
  size: number;
  modifiedAt: string;
}

async function loadSkills(): Promise<{ skills: SkillSummary[]; error?: string }> {
  const base = process.env.AGENT_INTERNAL_URL ?? 'http://agent:4101';
  try {
    const r = await fetch(`${base}/api/admin/skills`, {
      cache: 'no-store',
      headers: {
        'x-wdg-user-role': 'admin',  // 由 layout 鉴权, 此处内调直走
      },
    });
    if (!r.ok) {
      return { skills: [], error: `HTTP ${r.status}` };
    }
    const j = (await r.json()) as { success: boolean; skills: SkillSummary[] };
    return { skills: j.skills ?? [] };
  } catch (e) {
    return { skills: [], error: (e as Error).message };
  }
}

export default async function Page() {
  const { skills, error } = await loadSkills();
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-900">Skill 管理</h1>
        <p className="text-xs text-gray-500">Agent 的 5 个预定义工作流。修改后需要点 Reload 生效。</p>
      </header>
      <main className="mx-auto max-w-6xl p-6">
        <ClientSkillList initialSkills={skills} initialError={error ?? null} />
      </main>
    </div>
  );
}
