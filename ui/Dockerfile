# syntax=docker/dockerfile:1

# Alpine is dramatically faster to build on this VPS network.
# We install python deps from APK (no pip) to run import scripts triggered by /api/upload.

FROM node:20-alpine AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Python runtime + libs for import scripts
# VPS 网络下 Alpine 构建更稳：用 APK 装 pandas/psycopg2，避免 apt 源超时。
# 默认切到阿里云镜像源（更快更稳）；如需回退，可在构建时覆盖该 RUN。
RUN sed -i 's#https\?://dl-cdn.alpinelinux.org#https://mirrors.aliyun.com#g' /etc/apk/repositories && \
    apk add --no-cache \
      python3 \
      py3-pip \
      py3-pandas \
      py3-psycopg2 \
      py3-openpyxl

COPY --from=builder /app .

EXPOSE 3000
CMD ["npm","run","start","--","-p","3000","-H","0.0.0.0"]
