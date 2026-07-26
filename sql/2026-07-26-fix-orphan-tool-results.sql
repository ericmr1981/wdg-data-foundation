-- 修复 issue #38:清理已存在的孤儿 tool_result 行。
--
-- 孤儿定义:一条 user(tool_results) 消息里的某个 tool_use_id,在它之前同一会话中
-- 没有任何 assistant(tool_calls) 含有对应 id。孤儿 tool_result 会在历史重放时让
-- LLM 返回 400 "tool result's tool id not found"。
--
-- 本脚本只保留能配对的 tool_result,把孤儿项从 tool_results 数组中剔除(幂等,可重跑)。
-- 运行前先用下方 SELECT 预览将受影响的行。

-- 预览:哪些 user 消息含有孤儿 tool_result
SELECT m.conversation_id,
       m.message_id,
       jsonb_array_length(m.tool_results)                                                    AS total,
       (SELECT count(*)
        FROM jsonb_array_elements(m.tool_results) tr
        WHERE NOT EXISTS (
          SELECT 1
          FROM agent.messages a
          WHERE a.conversation_id = m.conversation_id
            AND a.role = 'assistant'
            AND a.message_id < m.message_id
            AND a.tool_calls @> jsonb_build_array(jsonb_build_object('id', tr ->> 'tool_use_id'))
        ))                                                                                    AS orphan_count
FROM agent.messages m
WHERE m.role = 'user'
  AND m.tool_results IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(m.tool_results) tr
    WHERE NOT EXISTS (
      SELECT 1
      FROM agent.messages a
      WHERE a.conversation_id = m.conversation_id
        AND a.role = 'assistant'
        AND a.message_id < m.message_id
        AND a.tool_calls @> jsonb_build_array(jsonb_build_object('id', tr ->> 'tool_use_id'))
    )
  );

-- 修复:仅保留能配对的 tool_result
UPDATE agent.messages m
SET tool_results = (
  SELECT COALESCE(jsonb_agg(tr), '[]'::jsonb)
  FROM jsonb_array_elements(m.tool_results) tr
  WHERE EXISTS (
    SELECT 1
    FROM agent.messages a
    WHERE a.conversation_id = m.conversation_id
      AND a.role = 'assistant'
      AND a.message_id < m.message_id
      AND a.tool_calls @> jsonb_build_array(jsonb_build_object('id', tr ->> 'tool_use_id'))
  )
)
WHERE m.role = 'user'
  AND m.tool_results IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(m.tool_results) tr
    WHERE NOT EXISTS (
      SELECT 1
      FROM agent.messages a
      WHERE a.conversation_id = m.conversation_id
        AND a.role = 'assistant'
        AND a.message_id < m.message_id
        AND a.tool_calls @> jsonb_build_array(jsonb_build_object('id', tr ->> 'tool_use_id'))
    )
  )
  AND m.conversation_id IS NOT NULL;
