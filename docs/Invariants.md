# Invariants (Local-dev)

> 本仓库只维护本地开发。

- 不在仓库中明文提交任何真实密钥（API key / DB password / cookie / token）。
- 变更必须可回滚：优先追加式 SQL（CREATE OR REPLACE / IF NOT EXISTS），避免破坏性 DROP。
- 任何会影响 schema/ETL 行为的变更：必须跑 `bash scripts/run_change_guard.sh`。
- 文档若提到部署/迁移（VPS）：统一归档，不在本仓库维护（见 `docs/VPS_ARCHIVE.md`）。
