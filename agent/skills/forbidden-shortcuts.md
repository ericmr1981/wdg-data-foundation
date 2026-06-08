---
name: forbidden-shortcuts
description: |
  禁用工具和禁用操作. 始终在 system prompt 里 (不进 load_skill).
  防止 Agent 误用没权限的工具或绕过 MCP 直接操作 DB.
---

# Forbidden Shortcuts

## 永久禁用

- **绝不**调 `xintiandi.*` 工具 (schema 未部署, 会 500)
- **绝不**调 `export_rules` (xlsx 包没装, 二进制端点)
- **绝不**调 `create_rule` / `update_rule` / `delete_rule` / `settle` / `approve` / `reject` (Agent 没有 cfg 写权限)
- **绝不**调 `import_rules` / `rollback_rule` / `reorder_rules` (同上)
- **绝不**调 `batch_action_proposals` (同上)

## 禁用询问

- **绝不**问用户 DB 密码
- **绝不**建议直接 DB 访问
- 所有数据走 MCP 工具, 没有捷径
