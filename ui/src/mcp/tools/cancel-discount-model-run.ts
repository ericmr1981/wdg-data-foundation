import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const CancelDiscountModelRunInput = z.object({
  run_id: z.string().describe('Run ID of a currently running discount_model pipeline'),
});

/**
 * cancel-discount-model-run
 *
 * 唯一允许 MCP 触发的"写"操作：仅写 ops.pipeline_run.cancel_requested。
 * 不会立即停止运行中的脚本，Python 脚本每 5 秒轮询该标志后优雅退出。
 *
 * 操作语义：
 *   - 只在 status='running' 的行上生效
 *   - 不修改任何 snapshot / is_active
 *   - 用户必须显式再触发 publish 才能激活新版本
 */
export const cancelDiscountModelRunTool = {
  name: 'cancel_discount_model_run',
  description: `Request cancellation of a running discount_model pipeline. Sets
ops.pipeline_run.cancel_requested=true. The Python script polls this flag every 5
seconds and exits gracefully within ~5-10s. Does NOT modify snapshots or is_active.`,
  inputSchema: CancelDiscountModelRunInput,
  async execute(params: z.infer<typeof CancelDiscountModelRunInput>) {
    const res = await mcpFetch(`/api/admin/discount-model/cancel`, {
      method: 'POST',
      headers: { 'x-mcp-session': 'internal', 'Content-Type': 'application/json' },
      body: JSON.stringify({ run_id: params.run_id }),
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, error: json.error || `HTTP ${res.status}` };
    return json;
  },
};