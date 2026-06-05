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

## Edge cases

- Logged out: widget button still visible; click → first message returns "请先登录" (HTTP 401).
- ANTHROPIC_API_KEY missing: AI message says "AI service not configured".
- Tool chain depth > 5: server sends `{type:'error', message:'tool chain too deep'}`.
