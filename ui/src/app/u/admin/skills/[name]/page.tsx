// ui/src/app/u/admin/skills/[name]/page.tsx
// Edit a single skill.
import { ClientSkillEdit } from './ClientSkillEdit';

export const dynamic = 'force-dynamic';

interface SkillDetail {
  name: string;
  description: string;
  triggers: string[];
  body: string;
  raw: string;
  filename: string;
}

async function loadSkill(name: string): Promise<{ skill: SkillDetail | null; error?: string }> {
  const base = process.env.AGENT_INTERNAL_URL ?? 'http://agent:4101';
  try {
    const r = await fetch(`${base}/api/admin/skills/${encodeURIComponent(name)}`, {
      cache: 'no-store',
      headers: { 'x-wdg-user-role': 'admin' },
    });
    if (r.status === 404) return { skill: null, error: 'not found' };
    if (!r.ok) return { skill: null, error: `HTTP ${r.status}` };
    const j = (await r.json()) as { success: boolean } & SkillDetail;
    if (!j.success) return { skill: null, error: 'load failed' };
    return { skill: j };
  } catch (e) {
    return { skill: null, error: (e as Error).message };
  }
}

export default async function Page({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const { skill, error } = await loadSkill(name);
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-900">Skill 管理 / {name}</h1>
        <p className="text-xs text-gray-500">编辑 skill frontmatter 与 body. 保存后需要 Reload 生效.</p>
      </header>
      <main className="mx-auto max-w-5xl p-6">
        {error ? (
          <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            加载失败: {error} — <a className="underline" href="/u/admin/skills">返回列表</a>
          </div>
        ) : skill ? (
          <ClientSkillEdit
            name={skill.name}
            initialDescription={skill.description}
            initialTriggers={skill.triggers}
            initialRaw={skill.raw}
          />
        ) : null}
      </main>
    </div>
  );
}
