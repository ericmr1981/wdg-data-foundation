# WDG Data Foundation｜VPS 迁移 Secrets（模板，不提交真实值）

> 把真实值写入 `docs/VPS_MIGRATION_SECRETS.md`（并确保被 .gitignore 忽略）。

## 1) VPS 信息
- VPS OS: Ubuntu（版本：____）
- VPS IP: ____
- SSH user: ____
- SSH port: ____

## 2) 域名与访问
- UI 域名（可选）: ____
- Metabase 域名（可选）: ____
- 是否公网开放：UI(是/否) / Metabase(是/否) / Postgres(强烈建议否)

## 3) GitHub 拉取方式（Route 1）
- repo: `github.com/<owner>/<repo>`
- clone 方式：SSH（deploy key）
- deploy key 存放路径（VPS）: ____

## 4) 环境变量（VPS .env）
- DB_NAME=
- DB_USER=
- DB_PASSWORD=
- DB_PORT=
- UI_PORT=
- METABASE_PORT=

## 5) 备份（建议）
- pg_dump 备份目录: ____
- 保留天数: ____
