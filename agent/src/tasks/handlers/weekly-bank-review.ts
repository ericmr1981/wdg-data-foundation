// agent/src/tasks/handlers/weekly-bank-review.ts
import { registerTaskHandler } from '../registry.js'
import type { TaskRow, TaskStepUpdate } from '../types.js'
import type { UnifiedMcpBridge } from '../../mcp/bridge.js'

export function registerWeeklyBankReview(mcpBridge: UnifiedMcpBridge): void {
  registerTaskHandler('weekly_bank_review', async function* (task: TaskRow): AsyncGenerator<TaskStepUpdate> {
    const brand = (task.input?.brand as string | null) ?? null

    yield { stepIndex: 1, description: '获取 KPI 概览', status: 'RUNNING' }
    const kpi = await mcpBridge.call('get_pipeline_kpi', { brand })
    yield { stepIndex: 1, description: '获取 KPI 概览', status: kpi.success ? 'DONE' : 'FAILED', result: kpi.data, error: kpi.error }

    yield { stepIndex: 2, description: '拉取未分类文件', status: 'RUNNING' }
    const files = await mcpBridge.call('get_unclassified_by_file', { brand, limit: 10 })
    yield { stepIndex: 2, description: '拉取未分类文件', status: files.success ? 'DONE' : 'FAILED', result: files.data }
  })
}
