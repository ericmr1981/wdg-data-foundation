-- scripts/seed-mock-data.sql
-- 给 agent_dev 数据库插入 mock 数据, 方便本地预览
-- 用法: cat scripts/seed-mock-data.sql | docker compose exec -T agent-test-db psql -U agent -d agent_dev
-- Idempotent: 不会重复插入

-- ─── 1 个 conversation ─────────────────
INSERT INTO agent.conversations (user_id, brand, channel_id, summary)
SELECT 'dev-user-1', 'yufeng', 'web', '本地开发测试会话'
WHERE NOT EXISTS (
  SELECT 1 FROM agent.conversations WHERE user_id = 'dev-user-1'
);

-- ─── 几条消息 ─────────────────
INSERT INTO agent.messages (conversation_id, role, content)
SELECT conversation_id, 'user', '上周怎么样'
FROM agent.conversations WHERE user_id = 'dev-user-1'
  AND NOT EXISTS (
    SELECT 1 FROM agent.messages m
    WHERE m.conversation_id = agent.conversations.conversation_id
      AND m.role = 'user' AND m.content = '上周怎么样'
  );

INSERT INTO agent.messages (conversation_id, role, content, thinking)
SELECT conversation_id, 'assistant', '上周有 89 笔未分类, 主要来自供应商 X', '思考: 加载 weekly-bank-review skill...'
FROM agent.conversations WHERE user_id = 'dev-user-1'
  AND NOT EXISTS (
    SELECT 1 FROM agent.messages m
    WHERE m.conversation_id = agent.conversations.conversation_id
      AND m.role = 'assistant' AND m.content LIKE '上周有 89 笔未分类%'
  );

-- ─── 2 个 task (历史 done) ─────────────────
INSERT INTO agent.tasks (status, task_type, input, user_id, result, progress, started_at, finished_at)
SELECT 'DONE', 'weekly_bank_review', '{"brand":"yufeng"}'::jsonb, 'system',
       '{"summary":"周报: 89 笔未分类"}'::jsonb, 100,
       NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day' + INTERVAL '5 minutes'
WHERE NOT EXISTS (
  SELECT 1 FROM agent.tasks WHERE user_id = 'system' AND task_type = 'weekly_bank_review'
    AND input->>'brand' = 'yufeng'
    AND started_at > NOW() - INTERVAL '2 days'
);

INSERT INTO agent.tasks (status, task_type, input, user_id, result, progress, started_at, finished_at)
SELECT 'DONE', 'weekly_bank_review', '{"brand":"bonjur"}'::jsonb, 'system',
       '{"summary":"周报: 45 笔未分类"}'::jsonb, 100,
       NOW() - INTERVAL '8 days', NOW() - INTERVAL '8 days' + INTERVAL '3 minutes'
WHERE NOT EXISTS (
  SELECT 1 FROM agent.tasks WHERE user_id = 'system' AND task_type = 'weekly_bank_review'
    AND input->>'brand' = 'bonjur'
    AND started_at > NOW() - INTERVAL '9 days'
);

-- ─── 几条 audit (LLM / MCP / 任务) ─────────────────
INSERT INTO agent.audit_log (action, payload)
SELECT 'llm.call', '{"model":"claude-opus-4-8","input_tokens":100,"output_tokens":50}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM agent.audit_log WHERE action = 'llm.call'
    AND payload->>'model' = 'claude-opus-4-8'
);

INSERT INTO agent.audit_log (action, payload)
SELECT 'mcp.call', '{"tool":"get_pipeline_kpi","success":true}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM agent.audit_log WHERE action = 'mcp.call'
    AND payload->>'tool' = 'get_pipeline_kpi'
);

INSERT INTO agent.audit_log (action, payload)
SELECT 'task.enqueue', '{"taskType":"weekly_bank_review"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM agent.audit_log WHERE action = 'task.enqueue'
    AND payload->>'taskType' = 'weekly_bank_review'
);
