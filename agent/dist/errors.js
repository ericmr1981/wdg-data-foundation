// agent/src/errors.ts
// 5 类错误源: LLM / MCP / Task / Auth / System
// 统一接口, 方便 Fastify error handler 处理
import Anthropic from '@anthropic-ai/sdk';
export class AgentError extends Error {
    code;
    retryable;
    cause;
    constructor(code, message, retryable, cause) {
        super(message);
        this.code = code;
        this.retryable = retryable;
        this.cause = cause;
        this.name = 'AgentError';
    }
}
export class LlmError extends AgentError {
    constructor(code, message, retryable, cause) {
        super(code, message, retryable, cause);
        this.name = 'LlmError';
    }
}
export class McpError extends AgentError {
    constructor(code, message, retryable, cause) {
        super(code, message, retryable, cause);
        this.name = 'McpError';
    }
}
export class TaskError extends AgentError {
    constructor(code, message, retryable, cause) {
        super(code, message, retryable, cause);
        this.name = 'TaskError';
    }
}
export class AuthError extends AgentError {
    constructor(code, message) {
        super(code, message, false);
        this.name = 'AuthError';
    }
}
export class SystemError extends AgentError {
    constructor(code, message) {
        super(code, message, false);
        this.name = 'SystemError';
    }
}
// ─── 辅助: 从 Anthropic 错误映射 ───
// Legacy: HTTP-status → LlmErrorCode. 仍供 admin test-run 调试端点使用。
// (R4 前叫 mapAnthropicError;为避免与新 ChatErrorCode 版本重名而改名。)
export function mapAnthropicStatusError(e) {
    const status = e?.status ?? e?.statusCode;
    if (status === 401)
        return 'LLM_AUTH';
    if (status === 429)
        return 'LLM_RATE_LIMIT';
    if (status === 529 || status === 503)
        return 'LLM_OVERLOADED';
    if (status === 408 || status === 504)
        return 'LLM_TIMEOUT';
    if (status === 400)
        return 'LLM_BAD_REQUEST';
    return 'LLM_RETRY_EXHAUSTED';
}
// R4: 从 Anthropic SDK 错误实例映射到 wire 协议的 ChatErrorCode。
// 用 instanceof 判类型,而不是猜 status。
export function mapAnthropicError(e) {
    if (e instanceof Anthropic.RateLimitError)
        return 'rate_limit';
    if (e instanceof Anthropic.AuthenticationError)
        return 'auth';
    if (e instanceof Anthropic.PermissionDeniedError)
        return 'permission';
    if (e instanceof Anthropic.NotFoundError)
        return 'not_found';
    if (e instanceof Anthropic.APIConnectionError)
        return 'network';
    if (e instanceof Anthropic.BadRequestError)
        return 'bad_request';
    return 'unknown';
}
// R4: 解析 RateLimitError 的 Retry-After 头,返回毫秒。缺省 60s。
export function retryAfterMs(e) {
    const headers = e.headers ?? e.response?.headers ?? {};
    const h = headers['retry-after'];
    if (!h)
        return 60_000;
    const n = Number(h);
    if (Number.isFinite(n))
        return n * 1000;
    const parsed = Date.parse(h) - Date.now();
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
}
// ─── 辅助: 从 MCP 错误映射 ───
export function mapMcpError(code) {
    if (code === -32601)
        return 'MCP_TOOL_NOT_FOUND'; // Method not found
    if (code === -32602)
        return 'MCP_BAD_ARGS'; // Invalid params
    if (code === -32603)
        return 'MCP_DB_ERROR'; // Internal error
    if (code === 401 || code === 403)
        return 'MCP_PERMISSION';
    if (code === 502 || code === 503 || code === 504)
        return 'MCP_NETWORK';
    if (code === 42)
        return 'MCP_VIEW_NOT_READY'; // PG 42P01 等
    return 'MCP_DB_ERROR';
}
