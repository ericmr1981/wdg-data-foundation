#!/usr/bin/env bash
# deploy-from-acr.sh — Manual deploy of ui from Aliyun Container Registry (ACR)
#
# 用法:
#   ACR_USERNAME=xxx ACR_PASSWORD=yyy ./deploy-from-acr.sh [tag]
#
# 默认 tag 是 latest。可指定 commit-sha 或版本号: ./deploy-from-acr.sh a5f33f7
#
# 流程:
#   1. docker login 到 ACR
#   2. 从 ACR pull 镜像
#   3. docker compose up -d --no-deps ui（复用现成 image，不重新 build）
#
# 注意: VPS 上不能 build（Cloudflare IP RST 拉不到 docker.io base image），
#       所以这里只 pull + restart。

set -euo pipefail

# -------- 配置 --------
ACR_REGISTRY="${ACR_REGISTRY:-registry.cn-hangzhou.aliyuncs.com}"
ACR_NAMESPACE="${ACR_NAMESPACE:-wdg-data-foundation}"   # ACR 个人版 namespace
ACR_REPO="${ACR_REPO:-ui}"                                # ACR 仓库名
IMAGE_TAG="${1:-latest}"
FULL_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/${ACR_REPO}:${IMAGE_TAG}"

# UI_IMAGE env 会被 docker-compose.dashboard.yml 通过 \${UI_IMAGE:-...} 读取
export UI_IMAGE="${FULL_IMAGE}"

# -------- 凭证检查 --------
: "${ACR_USERNAME:?需要设置 ACR_USERNAME env var}"
: "${ACR_PASSWORD:?需要设置 ACR_PASSWORD env var}"

cd "$(dirname "$0")/.."

echo ">>> [1/4] docker login ${ACR_REGISTRY}"
echo "${ACR_PASSWORD}" | docker login "${ACR_REGISTRY}" \
  -u "${ACR_USERNAME}" --password-stdin >/dev/null

echo ">>> [2/4] docker pull ${FULL_IMAGE}"
docker pull "${FULL_IMAGE}"

echo ">>> [3/4] docker compose up -d --no-deps ui"
/usr/local/bin/docker-compose -f docker-compose.dashboard.yml up -d --no-deps ui

echo ">>> [4/4] 验证"
sleep 3
docker ps --filter "name=dataplatform-ui" --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
curl -sI -o /dev/null -w "HTTP %{http_code} (UI root)\n" http://127.0.0.1:3002/ || true

echo ">>> 完成 ✅"
