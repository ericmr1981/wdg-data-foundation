# archive/docker-era

项目从 docker-compose 时代迁移到 systemd 后保留下来的历史制品。

## 内容

| 文件 | 来源 commit | 用途 |
|---|---|---|
| `migrate_docker_to_systemd.sh` | `79d2e9e` (PR #8, 2026-06-16) | 一次性迁移脚本：把 docker-compose 上的数据/服务迁到 systemd |
| `migrate_helpers.py` | `79d2e9e` (PR #8) | 上面脚本调用的 Python helper |
| `test_migrate_helpers.py` | `79d2e9e` (PR #8) | migrate_helpers.py 的单元测试 |
| `preview-only-agent.yml` | `5195915` (PR #4, 2026-06-14) | PR #4 时代的 agent 服务 docker-compose 预览配置 |

## 为什么不直接删

迁移已在 PR #8 完成，docker-compose 栈已废弃。这些文件作为迁移流程的历史记录保留，
方便后续需要查"从 docker 迁到 systemd 时做了什么"。

## 现状

仓库当前无 Dockerfile / docker-compose.yml。新部署路径见：

- `docs/SYSTEMD_DEPLOY.md` — systemd 部署运维手册
- `deploy/systemd/` — 7 个 systemd unit（postgres / ui / agent / agent-db / scheduler / ws-proxy / target）
