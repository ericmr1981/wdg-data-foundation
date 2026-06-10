#!/usr/bin/env bash
# check-acr-update.sh — VPS 定时任务: 检查 ACR 是否有新 image, 有则拉取 + restart
#
# 调用方式: /opt/wdg-data-foundation/scripts/check-acr-update.sh
# 由 cron 每 5 分钟调用
#
# 触发逻辑:
#   1. 拉 ACR ui:latest 的 manifest digest
#   2. 跟本地 wdg-data-foundation-ui:latest 的 digest 对比
#   3. 不一致 → pull 新 image + restart ui 容器
#   4. 一致 → 静默退出
#
# 日志: 写到 /var/log/wdg-acr-deploy.log,失败时通过 cron MAILTO 通知

set -uo pipefail

ACR_REGISTRY="${ACR_REGISTRY:-registry.cn-hangzhou.aliyuncs.com}"
ACR_NAMESPACE="${ACR_NAMESPACE:-wdg-data-foundation}"
ACR_REPO="${ACR_REPO:-ui}"
LOCAL_IMAGE="wdg-data-foundation-ui:latest"
ACR_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/${ACR_REPO}:latest"

LOG_FILE="/var/log/wdg-acr-deploy.log"
COMPOSE_DIR="/opt/wdg-data-foundation"

mkdir -p "$(dirname "$LOG_FILE")"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

# 凭证必须由 cron 调用时提供 (env 或 .env.creds)
# 优先读 /root/.config/wdg-acr/credentials 文件 (mode 600)
CREDS_FILE="/root/.config/wdg-acr/credentials"
if [[ -f "$CREDS_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$CREDS_FILE"
fi
: "${ACR_USERNAME:?ACR_USERNAME not set}"
: "${ACR_PASSWORD:?ACR_PASSWORD not set}"

log "检查 ACR 更新: $ACR_IMAGE"

# 1. 取 ACR latest 的 digest
ACR_DIGEST=$(docker buildx imagetools inspect "$ACR_IMAGE" --raw 2>/dev/null \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('manifests',[{}])[0].get('digest') or d.get('digest',''))" 2>/dev/null)
# buildx imagetools 在某些情况会失败, 改用 manifest API
if [[ -z "$ACR_DIGEST" ]]; then
  AUTH=$(echo -n "${ACR_USERNAME}:${ACR_PASSWORD}" | base64 -w0)
  TOKEN_JSON=$(curl -fsS -m 8 -u "${ACR_USERNAME}:${ACR_PASSWORD}" \
    "https://${ACR_REGISTRY}/v2/" 2>/dev/null | head -1)
  # fallback: 直接用 docker pull --quiet 然后看 image digest
  ACR_DIGEST=$(docker pull "$ACR_IMAGE" 2>&1 | grep -oE 'sha256:[a-f0-9]{64}' | head -1)
  if [[ -z "$ACR_DIGEST" ]]; then
    log "ERROR: 无法获取 ACR image digest"
    exit 1
  fi
fi
log "ACR digest: $ACR_DIGEST"

# 2. 取本地 latest 的 digest (如果不存在返回空)
LOCAL_DIGEST=$(docker images --digests --format '{{.Digest}}' "$LOCAL_IMAGE" 2>/dev/null | head -1)
# 如果本地没 ACR image tag, 直接 tag 一下作为对照
if ! docker image inspect "$ACR_IMAGE" >/dev/null 2>&1; then
  log "本地无 $ACR_IMAGE tag, 需要先 pull"
  LOCAL_DIGEST="<none>"
fi
log "Local digest: $LOCAL_DIGEST"

# 3. 对比
if [[ "$ACR_DIGEST" == "$LOCAL_DIGEST" ]]; then
  log "已是最新, 跳过"
  exit 0
fi

log "检测到新 image, 开始 pull + restart"
echo "${ACR_PASSWORD}" | docker login "${ACR_REGISTRY}" -u "${ACR_USERNAME}" --password-stdin >/dev/null 2>&1
docker pull "$ACR_IMAGE" 2>&1 | tee -a "$LOG_FILE"

cd "$COMPOSE_DIR"
export UI_IMAGE="$ACR_IMAGE"
/usr/local/bin/docker-compose -f docker-compose.dashboard.yml up -d --no-deps ui 2>&1 | tee -a "$LOG_FILE"

sleep 3
if curl -fsS -o /dev/null -m 5 http://127.0.0.1:3002/login; then
  log "✅ 部署成功, UI 200 OK"
else
  log "⚠️ 容器起了但 UI 不响应, 请检查"
  exit 1
fi
