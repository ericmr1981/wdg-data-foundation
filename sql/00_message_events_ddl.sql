-- 2026-07-10: agent.message_events — replay 端点用
-- R7 (Phase 3): 给 GET /api/chat/conversations/:id/events?after=<id> 增量回放
--
-- 设计要点:
-- 1. id 用 text PRIMARY KEY, 形如 'evt_<base36ts>_<rand6>'
--    时间序前缀让 `WHERE id > $after` 走 B-tree 索引;
--    避免 UUID + ORDER BY ts(走 IO 排序)
-- 2. (conversation_id, id) 复合索引 — 单会话内增量扫的命中路径
-- 3. ts 用 bigint(Date.now(), ms) — 跟 agent.messages.created_at 不一样, 这里只做 wall-clock ordering

CREATE TABLE IF NOT EXISTS agent.message_events (
  id              text PRIMARY KEY,
  conversation_id text NOT NULL,
  type            text NOT NULL,
  payload         jsonb NOT NULL,
  ts              bigint NOT NULL,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_events_conv_id
  ON agent.message_events(conversation_id, id);
