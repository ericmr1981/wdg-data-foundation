# WDG Data Foundation — 全量服务重启检查清单

## 服务
- [ ] wdg-agent: active (Node v22.23.1)
- [ ] wdg-ui: active
- [ ] wdg-postgres: active
- [ ] wdg-postgres-agent: active

## 端口
- [ ] 4101 Agent HTTP → `curl http://127.0.0.1:4101/health`
- [ ] 4102 Agent WS → `ws://127.120.0.1:4102` (auto `hello` on connect)
- [ ] 3001 UI → browser open
- [ ] 5432 PostgreSQL main
- [ ] 5433 PostgreSQL agent

## Agent 配置
- [x] AGENT_PROTOCOL_VERSION=1
- [x] AGENT_JWKS_URL=http://192.168.1.5:3000/api/auth/jwks.json
- [x] initAuth 成功 (JWKS loaded kid=portal-1783666777404)

## Portal
- [ ] Portal server 3000 running (mac)
- [ ] /api/auth/jwks.json → 200
- [ ] /api/auth/dev-login → cookie
- [ ] /api/agent-token → RS256 token

## 端到端验证
- [ ] WS: hello → ack → message_start → content_block_delta* → message_stop
