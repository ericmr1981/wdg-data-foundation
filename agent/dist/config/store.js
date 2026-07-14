// agent/src/config/store.ts
// ConfigStore — Agent 进程内配置存储
// Phase 1: DB-first
// Phase R: env-only 留 AGENT_CRED_ENCRYPTION_KEY (解密 DB 那把 api key)
//         ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL / ANTHROPIC_MODEL 不再从 env 读,
//         完全靠 agent.config DB 表 (admin 页面管理)
//
// 来源策略:
//   - config 来自 DB (agent.config 表,id=1)
//   - 解密种子 AGENT_CRED_ENCRYPTION_KEY 来自 env (systemd EnvironmentFile = /etc/wdg/agent.env)
//   - DB 没行 / DB 读不到 → startAgentConfig 抛错, server.ts 选择 fast-fail (启动失败)
//
// 跟生产部署的关系: 生产 systemd unit 写 /etc/wdg/agent.env, 里面**只放**:
//   DATABASE_URL=postgresql://agent:...
//   AGENT_CRED_ENCRYPTION_KEY=<随机 32+ 字符>
//   MCP_ENDPOINT, ANTHROPIC_MODEL 等已废字段不需要 (默认值在 DEFAULT_PARAMS)
// new install 流程:
//   1. createdb + 建表 (sql/*.sql)
//   2. INSERT agent.config 一次 (seed script) — admin 在 UI 里改 key 也行
import { loadDefaultAgentMd } from './agent-md-loader.js';
import { decrypt } from '../crypto/secret-crypto.js';
import { getPool } from '../db.js';
const EFFORT_BY_LEVEL = {
    low: 'low',
    medium: 'medium',
    high: 'high',
};
export function thinkingConfigFor(level) {
    if (level === 'off')
        return null;
    return {
        thinking: { type: 'adaptive' },
        output_config: { effort: EFFORT_BY_LEVEL[level] },
    };
}
export const DEFAULT_PARAMS = {
    maxTokens: 4096,
    temperature: 0.3,
    topP: null,
    maxToolChainDepth: 10,
    rateLimitMaxPerMinute: 10,
    tokenSoftLimit: 80_000,
    tokenHardLimit: 200_000,
    mcpRetryMaxAttempts: 2,
    thinkingLevel: 'off',
};
// ─── defaults ───────────────────────
function defaultConfig() {
    return {
        agentMd: loadDefaultAgentMd(),
        params: { ...DEFAULT_PARAMS },
        baseURL: null,
        apiKey: null,
        model: 'claude-opus-4-8',
        jwksUrl: null,
        source: 'missing',
        mcpBackends: [],
    };
}
/**
 * 严格从 DB 读;DB 不可用或没行 → 返回 null。
 * R 设计: 不再读 ANTHROPIC_* env 兜底。
 */
async function loadFromDb() {
    try {
        const { rows } = await getPool().query(`
      SELECT base_url, encrypted_key, model, params, agent_md, jwks_url, mcp_backends
      FROM agent.config
      WHERE id = 1
    `);
        if (rows.length === 0)
            return null;
        const row = rows[0];
        let apiKey = null;
        const encKey = process.env.AGENT_CRED_ENCRYPTION_KEY;
        if (row.encrypted_key) {
            if (!encKey) {
                throw new Error('agent.config.encrypted_key exists but AGENT_CRED_ENCRYPTION_KEY env not set — ' +
                    'env 必须含解密钥');
            }
            try {
                apiKey = decrypt(row.encrypted_key, encKey);
            }
            catch (e) {
                throw new Error(`decrypt failed (AGENT_CRED_ENCRYPTION_KEY 与 DB 加密时的不一致): ${e.message}`);
            }
        }
        return {
            // env AGENT_MD_PATH 优先（文件覆盖 DB）
            agentMd: process.env.AGENT_MD_PATH ? loadDefaultAgentMd() : (row.agent_md ?? loadDefaultAgentMd()),
            params: row.params ? { ...DEFAULT_PARAMS, ...row.params } : { ...DEFAULT_PARAMS },
            baseURL: row.base_url,
            apiKey,
            model: row.model ?? 'claude-opus-4-8',
            jwksUrl: row.jwks_url ?? null,
            source: 'db',
            mcpBackends: normalizeBackends(row.mcp_backends),
        };
    }
    catch (e) {
        console.error('[config] loadFromDb error:', e.message);
        return null;
    }
}
const SLOT_KEY = '__wdg_agent_config__';
const g = globalThis;
const slot = (g[SLOT_KEY] ??= { current: defaultConfig() });
// ─── 读 ─────────────────────────────
export function getAgentConfig() { return slot.current; }
export function getBaseURL() { return slot.current.baseURL; }
export function getApiKey() { return slot.current.apiKey; }
export function getModel() { return slot.current.model; }
export function getConfigSource() { return slot.current.source; }
/**
 * 返回 JWKS URL。优先级: DB 配置 > AGENT_JWKS_URL env > null。
 */
export function getJwksUrl() {
    return slot.current.jwksUrl ?? process.env.AGENT_JWKS_URL ?? null;
}
/**
 * server.ts 启动时必须 await 这个函数。
 * R 设计: DB-only。失败抛错由 server.ts 决定要不要 fast-fail。
 */
export async function initAgentConfig() {
    const dbCfg = await loadFromDb();
    if (dbCfg) {
        slot.current = dbCfg;
        return;
    }
    // DB 读不到 (没 row / 解密失败 / DB 不可达) → 留 defaultConfig() 让 server 决定
    // server.ts 在 main() 开头判断 source==='missing' → 直接退出
    slot.current = defaultConfig();
}
/** 重新读 DB(给 admin GET 用,跟 in-memory cache 同步) */
export async function reloadFromDb() {
    const cfg = await loadFromDb();
    if (cfg)
        slot.current = cfg;
    return cfg;
}
/**
 * server.ts 启动检查用: 如果 in-memory 是 missing 状态, server 应该 fail-fast
 */
export function isConfigReady() {
    return slot.current.source === 'db' && !!slot.current.apiKey;
}
// ─── 写 (in-memory, admin/config.ts 路由负责把这个写 DB) ──
export function setAgentMd(content) {
    slot.current = { ...slot.current, agentMd: content };
}
export function setParam(key, value) {
    slot.current = { ...slot.current, params: { ...slot.current.params, [key]: value } };
}
export function setParams(params) {
    slot.current = { ...slot.current, params: { ...slot.current.params, ...params } };
}
export function setCredentialConfig(baseURL, apiKey, model) {
    slot.current = { ...slot.current, baseURL, apiKey, model };
}
export function setJwksUrl(jwksUrl) {
    slot.current = { ...slot.current, jwksUrl };
}
/** 设置外部 MCP 后端列表 (in-memory, 不写 DB) */
export function setMcpBackends(backends) {
    slot.current = { ...slot.current, mcpBackends: backends };
}
export function resetAgentConfig() {
    slot.current = defaultConfig();
}
/** 规范化后端配置：去重、补齐默认值、校验必填字段 */
function normalizeBackends(raw) {
    if (!Array.isArray(raw))
        return [];
    const seen = new Set();
    const out = [];
    for (const b of raw) {
        if (!b?.name || !b?.url)
            continue;
        if (seen.has(b.name))
            continue;
        seen.add(b.name);
        out.push({
            ...b,
            transport: b.transport ?? 'fetch',
            timeoutMs: b.timeoutMs ?? 30_000,
            required: b.required ?? false, // 缺省为 secondary:不阻塞启动
        });
    }
    return out;
}
