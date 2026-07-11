// agent/src/api/admin/config.ts
// Admin config endpoints — Phase R (DB as sole source).
//
// GET:  返回全量 config (in-memory 缓存)
// POST: 写 in-memory + 写 DB (persistent)
// /reset:  清空 credentials (api_key=null, base_url=null), model 复位
// /reload: 从 DB 重读
import { getAgentConfig, setAgentMd, setParams, setCredentialConfig, resetAgentConfig, DEFAULT_PARAMS, reloadFromDb, getConfigSource, } from '../../config/store.js';
import { encrypt } from '../../crypto/secret-crypto.js';
import { writeFileSync } from 'fs';
import { AGENT_MD_FILE_PATH } from '../../config/agent-md-loader.js';
import { getPool } from '../../db.js';
export function registerAdminConfigRoutes(app) {
    app.addHook('preHandler', async (req, reply) => {
        if (!req.url.startsWith('/api/admin/'))
            return;
        const role = req.headers['x-wdg-user-role'];
        if (role !== 'admin')
            return reply.code(403).send({ error: 'forbidden' });
    });
    // ─── GET ──────────────────────────────
    app.get('/api/admin/config', async () => {
        const cfg = getAgentConfig();
        return {
            success: true,
            agentMdContent: cfg.agentMd,
            params: cfg.params,
            defaultParams: DEFAULT_PARAMS,
            model: cfg.model,
            baseUrl: cfg.baseURL,
            hasApiKey: cfg.apiKey !== null,
            dirty: false,
            source: getConfigSource(),
        };
    });
    // ─── POST (upsert config into DB) ───────
    app.post('/api/admin/config', async (req) => {
        const { agentMd, params, credentials } = req.body;
        const oldCfg = getAgentConfig();
        // 1. 计算新值（部分提交语义）
        let newApiKey = undefined;
        let newBaseURL = undefined;
        let newModel = undefined;
        if (credentials) {
            if (credentials.hasOwnProperty('apiKey')) {
                newApiKey = credentials.apiKey ?? null;
            }
            if (credentials.hasOwnProperty('baseURL')) {
                newBaseURL = credentials.baseURL ?? null;
            }
            if (credentials.hasOwnProperty('model') && credentials.model) {
                newModel = credentials.model;
            }
        }
        // 2. 写 in-memory (立即生效)
        if (agentMd !== undefined) {
            setAgentMd(agentMd);
            try {
                writeFileSync(AGENT_MD_FILE_PATH, agentMd, 'utf-8');
            }
            catch (e) {
                console.error('[admin/config] write agent.md failed:', e);
            }
        }
        if (params)
            setParams(params);
        if (credentials) {
            // 合并 in-memory: 用提交的值 or in-memory 旧值
            const finalBaseURL = newBaseURL !== undefined ? newBaseURL : oldCfg.baseURL;
            const finalApiKey = newApiKey !== undefined ? newApiKey : oldCfg.apiKey;
            const finalModel = newModel ?? oldCfg.model ?? 'claude-opus-4-8';
            setCredentialConfig(finalBaseURL, finalApiKey, finalModel);
        }
        const newCfg = getAgentConfig();
        // 3. 写 DB (持久化)
        const encKey = process.env.AGENT_CRED_ENCRYPTION_KEY;
        if (!encKey) {
            console.warn('[admin/config] AGENT_CRED_ENCRYPTION_KEY env not set — DB write skipped');
        }
        else {
            try {
                const updated_by = String(req.headers['x-wdg-user-id'] ?? 'unknown');
                // 加密 apiKey: 只有当 POST body 里给了 apiKey 才写,否则保留 DB 原值
                let dbEncryptedKey = null;
                if (newApiKey !== undefined) {
                    dbEncryptedKey = newApiKey ? encrypt(newApiKey, encKey) : null;
                }
                const dbBaseUrl = newBaseURL !== undefined ? newBaseURL : oldCfg.baseURL;
                const dbModel = newModel ?? newCfg.model;
                const upsertSql = `
          INSERT INTO agent.config (id, base_url, encrypted_key, model, params, agent_md, updated_at, updated_by)
          VALUES (1, $1, $2, $3, $4, $5, NOW(), $6)
          ON CONFLICT (id) DO UPDATE SET
            base_url    = COALESCE(EXCLUDED.base_url, agent.config.base_url),
            encrypted_key = EXCLUDED.encrypted_key,
            model       = EXCLUDED.model,
            params      = EXCLUDED.params,
            agent_md    = EXCLUDED.agent_md,
            updated_at  = NOW(),
            updated_by  = EXCLUDED.updated_by
        `;
                await getPool().query(upsertSql, [
                    dbBaseUrl,
                    dbEncryptedKey,
                    dbModel,
                    JSON.stringify(newCfg.params),
                    newCfg.agentMd,
                    updated_by,
                ]);
                console.log('[admin/config] DB saved: baseUrl=' + dbBaseUrl + ' model=' + dbModel + ' hasKey=' + (dbEncryptedKey !== null));
            }
            catch (e) {
                console.error('[admin/config] DB write failed:', e.message);
                return { success: false, error: 'DB write failed (in-memory change kept)' };
            }
        }
        return { success: true, message: 'config updated' };
    });
    // ─── POST /reset (回退到 env) ─────
    app.post('/api/admin/config/reset', async () => {
        resetAgentConfig();
        return { success: true, message: 'in-memory reset (DB row untouched)' };
    });
    // ─── POST /reload (从 DB 重新读) ─────
    app.post('/api/admin/config/reload', async () => {
        const cfg = await reloadFromDb();
        return {
            success: !!cfg,
            source: cfg?.source ?? null,
            message: cfg ? 'reloaded from DB' : 'no DB row found',
        };
    });
}
