# WDG Project Tasks — Current Sprint

> 本文件为 WDG 项目当前工作的唯一任务入口（替代 CHANGELOG.md 中的散记）
> 所有变更记录请写在此文件，不要追加到 CHANGELOG.md

---

## Active Sprint

### 2026-Q1 遗留项

| ID | 描述 | 状态 | 备注 |
|----|------|------|------|
| P0 | 新品牌初始化完整性（init-bank-template 漏表/视图）| ✅ 已修复 | snapshot 表 + expense/profit 视图已补加，VPS 已部署 |
| P0 | gelatomiiix 数据库补建（snapshot 表 + refresh 函数）| ✅ 已修复 | VPS 直接执行 |
| P0 | import_yufeng_bank_txn.py schema 命名不一致 | ✅ 已修复 | get_ods_schema() / get_dm_schema() |
| P1 | Metabase 报表 brand 过滤支持 gelatomiiix | ✅ 已完成 | Dashboard (id=8) + DM 视图已创建；数据验证通过 |
| P1 | 新品牌上传银行数据端到端测试 | 🔵 待测试 | UI 重新上传 gelatomiiix 数据 |
| P2 | ops.brands init_vp 流程规范化 | 📋 待做 | 目前 VPS DDL 靠手动 apply |

---

## 技术债务

| ID | 描述 | 状态 | 备注 |
|----|------|------|------|
| D1 | rules_history.sql（fn_log_bank_rule_map_change）从未被 init 脚本引用 | ⚠️ 需修复 | 应在 init-brand 时自动 apply |
| D2 | sql/rules_history.sql 未同步到 Docker 镜像 | ⚠️ 需修复 | 当前靠手动 VPS apply |
| D3 | Metabase 报表 brand 隔离（多 brand 访问控制）| 📋 待做 | 目前无 schema 级访问控制 |

---

## 已完成（归档）

<details>
<summary>2026-03-30: 安全 + 稳定性 sprint</summary>

| ID | 描述 | 验证 |
|----|------|------|
| T-001 | 登录防暴力（5次/5分钟→429）| a14ba9c |
| T-002 | 上传文件白名单（.xlsx/.csv）| 2b66978 |
| T-003 | ETL 事务步骤回滚 | 201bd14 |
| T-004 | Schema 白名单校验 | 42effc3 |
| T-005 | 分类规则 JSON 化 + pytest | dd8ed86 |
</details>
