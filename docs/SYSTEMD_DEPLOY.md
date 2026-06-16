# WDG systemd 部署手册 (Linux VPS)

目标: 把 docker-compose 里的 4 个服务(postgres / ui / agent / agent-test-db)迁到 systemd。

## 一次性安装

```bash
# 1. 装 PostgreSQL 16
sudo apt install -y curl ca-certificates
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo gpg --dearmor -o /usr/share/keyrings/pgdg.gpg
echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo $VERSION_CODENAME)-pgdg main" \
  | sudo tee /etc/apt/sources.list.d/pgdg.list
sudo apt update
sudo apt install -y postgresql-16

# 2. 装 Node 20 (跟 agent/Dockerfile 对齐)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. 确认环境
node --version    # v20.x
psql --version    # 16.x
systemctl --version

# 4. clone 仓库到 /opt/wdg
sudo git clone <repo> /opt/wdg
sudo chown -R www-data:www-data /opt/wdg
cd /opt/wdg
cp .env.example .env  # 编辑填入实际值

# 5. 跑 install 脚本
sudo bash scripts/install_systemd.sh
```

## 数据迁移 (从 docker 来)

```bash
sudo bash scripts/migrate_docker_to_systemd.sh
```

dump 落在 `/tmp/wdg-migrate-<pid>/`,脚本退出时清空。如需长期保留:
```bash
cp -r /tmp/wdg-migrate-*/ ~/Documents/wdg-backups/
```

## 日常运维

| 操作 | 命令 |
|---|---|
| 看整组状态 | `systemctl status wdg.target` |
| 重启整组 | `sudo systemctl restart wdg.target` |
| 看日志(全部) | `journalctl -u wdg.target -f` |
| 看某服务 | `journalctl -u wdg-postgres -f` |
| 触发 scheduler 刷新 | `curl -X POST http://127.0.0.1:4711/reload` |
| 健康检查 | `sudo bash scripts/verify_systemd.sh` |

## 端口

| 服务 | 端口 | 绑定 |
|---|---|---|
| wdg-ws-proxy (公网入口) | 3000 | 0.0.0.0 |
| wdg-ui (next dev) | 3001 | 127.0.0.1 |
| wdg-agent (HTTP/admin) | 4101 | 127.0.0.1 |
| wdg-agent (WebChannel WS) | 4102 | 127.0.0.1 |
| wdg-scheduler | 4711 | 127.0.0.1 |
| 主 PostgreSQL | 5432 | 127.0.0.1 |
| Agent test DB | 5433 | 127.0.0.1 |

**外部访问 (用户视角)**: ECS 安全组**只放行 3000**。浏览器连 `http://112.124.18.246:3000`,所有内部端口 (3001/4101/4102/5432/5433/4711) 都不暴露公网 — `wdg-ws-proxy` 在 3000 入口根据路径分流:

- 普通 HTTP 请求 → 127.0.0.1:3001 (next dev)
- `Upgrade: websocket` 且路径 `/api/chat/ws` → 127.0.0.1:4102 (agent WebChannel)
- 其他 WS upgrade 拒绝

实现见 `agent/src/ws-proxy.ts` + `/etc/systemd/system/wdg-ws-proxy.service`。

Docker 时代用 3002 是历史包袱,systemd 时代直接走 3000,**不要**用 iptables DNAT 把 3002→3000 — 那是绕路。
Scheduler 4711 只本机调用,不对外。

**生产环境外部访问需配反代**(nginx / caddy),不在本设计范围。

## 故障排查

### `wdg-postgres` 起不来
```bash
sudo journalctl -u wdg-postgres -n 50 --no-pager
# 常见: PGDATA 权限不对 → sudo chown -R postgres:postgres /var/lib/postgresql/16/main
```

### UI 502
```bash
sudo journalctl -u wdg-ui -n 50 --no-pager
# 常见: .env 里 DB_HOST 应该是 127.0.0.1 不是 postgres (docker 时代是容器名)
```

### agent health 失败
```bash
sudo journalctl -u wdg-agent -n 50 --no-pager
# 常见: 1) agent-test-db 没起 2) MCP_ENDPOINT 指向 localhost:3000
# 3) agent/.env 里 DATABASE_URL 用了 docker 时代的 host (db:5432),
#    systemd 时代要改成 127.0.0.1:5433 或 localhost
```

## 卸载

```bash
sudo bash scripts/uninstall_systemd.sh
```

保留 PGDATA / docker / /opt/wdg。重装跑 `install_systemd.sh`。

## 相关文档

- 设计: `docs/superpowers/specs/2026-06-16-docker-to-systemd-design.md`
- 本地开发: `docs/LOCAL_STARTUP.md`
