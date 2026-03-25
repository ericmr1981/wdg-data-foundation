# WDG｜VPS 迁移计划（Route 1：VPS 通过 GitHub 拉取部署）

> 目标：把本机已跑通的「PG + ETL + UI + Dashboard(Metabase)」迁移到 VPS，部署过程以 GitHub 作为中转与版本源。
> 约束：**任何敏感信息（IP/域名/账号/密码/密钥）不写入仓库**。

---

## 0. 最终形态（一期）
- **全 Docker**（你已确认）：Postgres / UI / Metabase 均容器化
- **部署策略**：
  - GitHub：存放代码 + 部署文档 +（可选）Compose 文件
  - VPS：`git pull` 获取最新版本，然后 `docker compose up -d` 重启服务
- **运行模式**：T+1 批处理（cron 在 VPS 上调度 ETL）

---

## 1. 仓库内容与敏感信息隔离
### 1.1 仓库内（允许提交）
- `docker-compose.yml`（生产用）
- `.env.example`（变量名清单 + 默认值示例）
- `docs/`（本计划、Runbook、验收清单）
- `scripts/` / `sql/` / `ui/` 等代码

### 1.2 仓库外（禁止提交）
- `.env`（VPS 真实环境变量）
- `docs/VPS_MIGRATION_SECRETS.md`（敏感参数清单，见下文模板）
- 任意私钥/证书文件

建议在仓库根目录 `.gitignore` 添加：
```gitignore
.env
.env.*
docs/VPS_MIGRATION_SECRETS.md
```

---

## 2. VPS 目录规范（建议）
在 VPS 上：
- 代码目录：`/opt/wdg-data-foundation`
- 数据卷：由 Docker volumes 管理（PG / Metabase）

---

## 3. 部署流程（Route 1：VPS pull）
### 3.1 首次部署（一次性）
1) 安装 Docker / docker compose
2) 创建目录 `/opt/wdg-data-foundation`
3) 从 GitHub clone 仓库
4) 在 VPS 写入 `.env`（从 `.env.example` 拷贝，填真实值）
5) 启动服务：
   ```bash
   cd /opt/wdg-data-foundation
   docker compose up -d
   ```
6) 初始化数据库（运行初始化脚本/或 init 容器任务）：
   - 目标：schema/DDL/视图/规则都落库

### 3.2 日常发布（每次更新）
```bash
cd /opt/wdg-data-foundation

git pull

docker compose up -d --build
```

> 注：如果 UI 使用 `next dev`（开发模式）不适合 VPS；生产应走 `next build && next start`，建议写到 Dockerfile 里。

---

## 4. 服务清单（端口规划建议）
> 实际端口由 `.env` 控制。

- UI：`UI_PORT=3000`
- Metabase：`METABASE_PORT=3001`
- Postgres：**不建议暴露公网**；如果必须暴露，使用安全组白名单 + 强口令。

---

## 5. ETL 调度（Cron）
一期建议：在 VPS 上创建 cron，调用容器内或宿主机脚本。

最低要求：
- 能指定 brand / month（或默认跑“昨天/本月”）
- 日志落盘
- ops 元数据可在 UI `/pipeline` 里看到

---

## 6. 验收清单（上线前必须过）
1) `docker compose ps` 全部容器 healthy/running
2) UI 页面可访问（/pipeline /rules /match /upload）
3) Metabase 可访问（并能连到 PG）
4) 导入一份样例/真实文件，覆盖率视图有数据：
   - `yufeng_dm.v_coverage_monthly`
   - `yufeng_dm.v_coverage_by_file`
5) 回滚演练：
   - 能切回上一个 git commit/tag 并恢复服务

---

## 7. 回滚策略（最小可行）
- 使用 Git tag 或记录上一次 commit hash
- 回滚命令：
  ```bash
  cd /opt/wdg-data-foundation
  git checkout <good_commit>
  docker compose up -d --build
  ```

---

## 8. 需要你补充的信息（写入 Secrets 文件，不入库）
见：`docs/VPS_MIGRATION_SECRETS.example.md`
