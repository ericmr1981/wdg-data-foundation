#!/bin/bash
# 摘掉 systemd unit + target, 保留 PGDATA / docker / /opt/wdg。
# 重装用 install_systemd.sh (可重入)。
set -euo pipefail

SYSTEMD_DIR="/etc/systemd/system"
ENV_DIR="/etc/wdg"

echo "==> 停服务..."
systemctl disable --now wdg.target 2>/dev/null || true
for u in wdg-postgres wdg-postgres-agent wdg-ui wdg-agent wdg-scheduler; do
  systemctl disable --now "$u" 2>/dev/null || true
done

echo "==> 摘 unit 文件..."
for f in wdg-postgres.service wdg-postgres-agent.service wdg-ui.service \
         wdg-agent.service wdg-scheduler.service wdg.target; do
  rm -f "${SYSTEMD_DIR}/${f}"
done

systemctl daemon-reload

echo "==> 保留 (未删):"
echo "    - PGDATA: /var/lib/postgresql/16/{main,agent_main}"
echo "    - env:    ${ENV_DIR}/postgres*.env"
echo "    - /opt/wdg 仓库"
echo "    - docker 容器"
echo
echo "==> 提示: 重装跑 sudo bash scripts/install_systemd.sh"
