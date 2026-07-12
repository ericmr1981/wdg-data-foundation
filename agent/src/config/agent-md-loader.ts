// agent/src/config/agent-md-loader.ts
// 启动时从 agent/agent.md 加载业务指令

import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const CANDIDATE_PATHS = [
  join(__dirname, '..', '..', 'agent.md'),                   // agent/agent.md
  join(process.cwd(), 'agent.md'),
  join(__dirname, '..', '..', 'default-agent.md'),          // fallback
]

/** AGENT_MD_PATH env var 可覆盖 agent.md 文件路径 */
export const AGENT_MD_PATH =
  process.env.AGENT_MD_PATH ?? CANDIDATE_PATHS.find((p) => existsSync(p)) ?? CANDIDATE_PATHS[CANDIDATE_PATHS.length - 1] ?? process.cwd()

export function loadDefaultAgentMd(): string {
  try {
    return readFileSync(AGENT_MD_PATH, 'utf-8')
  } catch {
    return '# 项目级 Agent 指令\n\n（默认 agent.md 加载失败）\n'
  }
}

export { AGENT_MD_PATH as AGENT_MD_FILE_PATH }
