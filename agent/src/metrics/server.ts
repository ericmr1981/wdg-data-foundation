// agent/src/metrics/server.ts
import { Registry, Counter, Histogram, Gauge } from 'prom-client'

const registry = new Registry()

export const llmCallTotal = new Counter({
  name: 'agent_llm_call_total', help: 'LLM calls', labelNames: ['model', 'status'],
  registers: [registry],
})
export const llmLatency = new Histogram({
  name: 'agent_llm_latency_seconds', help: 'LLM call latency', labelNames: ['model'],
  buckets: [0.5, 1, 2, 5, 10, 30], registers: [registry],
})
export const mcpCallTotal = new Counter({
  name: 'agent_mcp_call_total', help: 'MCP tool calls', labelNames: ['tool', 'status'],
  registers: [registry],
})
export const mcpLatency = new Histogram({
  name: 'agent_mcp_latency_seconds', help: 'MCP call latency', labelNames: ['tool'],
  buckets: [0.05, 0.1, 0.5, 1, 2, 5], registers: [registry],
})
export const taskStatusGauge = new Gauge({
  name: 'agent_tasks_by_status', help: 'Tasks by status', labelNames: ['status'],
  registers: [registry],
})
export const activeWebsockets = new Gauge({
  name: 'agent_websockets_active', help: 'Active WS connections',
  registers: [registry],
})

export async function getMetrics(): Promise<string> {
  return registry.metrics()
}
