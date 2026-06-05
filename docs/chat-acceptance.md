# AI Chat Widget — Acceptance

Run `npm run dev` in `ui/`. Set `ANTHROPIC_API_KEY` in `ui/.env.local`.

## Manual checklist

1. Login; open any `/u/*` page. Floating 💬 button visible bottom-right.
2. Navigate to `/u/financial?brand=bonjur&store=wz_ra&period=2026-04`. Ask "这个月营收多少" → AI answers with a number.
3. Click 📎 → button shows "权限不足" tooltip if logged in as operator.
4. Click 🔄 重启 → messages clear; AI greets with a brand/store/period question.
5. Press Cmd+K (mac) / Ctrl+K → widget toggles.
6. Inspect `ops.chat_session_log` after a chat session: 1 new row; `ops.chat_tool_call`: N rows.
7. Stop the dev server mid-conversation → restart → widget shows cached history.
8. As admin, ask for store report → tool-call block expands → summary visible.

## Agent behaviors (since v2)

9. **Thinking text**: ask "上个月 bonjur 旗下所有门店的营收" → see a gray italic 💭 block with a sentence like "我先查 bonjur 有哪些门店" before the first tool call.
10. **Multi-step agent**: the same query should chain `get_brand_stores` → 3× `query_store_report_snapshot` automatically (visible as 4 tool_call blocks).
11. **Retry on 5xx**: trigger a tool that returns 503 (e.g. ask for a non-existent store_code with a server stub) → see "重试 1/2" yellow text on the tool_call block. If still 5xx, see ❌ at the end.
12. **No retry on 4xx**: trigger a 4xx (e.g. unauthenticated request) → no retry, immediate ❌.
13. **Token soft-cap**: in a long session, after cumulative tokens ≥ 80K, see a yellow "⚠️ Token 用量已达 …" notice. Subsequent system prompt is compact (no brand-code hints, but core rules preserved).
14. **Token hard-cap**: if a session reaches 200K cumulative tokens, the server returns `{type:'error', message:'对话超过 token 上限 (200K)，请重置会话后重试'}` and the loop ends.

## Edge cases

- Logged out: widget button still visible; click → first message returns "请先登录" (HTTP 401).
- ANTHROPIC_API_KEY missing: AI message says "AI service not configured".
- Tool chain depth > 10: server sends `{type:'error', message:'tool chain too deep'}`.
