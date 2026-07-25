/**
 * 模块级 PID 映射表：runId → child.pid
 * 用于 cancel/route.ts 在 UI 取消时 kill 子进程（Issue #36 Change 3）
 *
 * 与 Next.js route handler 分离，避免 tsc 类型冲突。
 */
export const pipelinePids = new Map<string, number>();
