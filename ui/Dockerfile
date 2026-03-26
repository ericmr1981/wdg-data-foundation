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

FROM node:20-bullseye-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Python runtime + libs for import scripts
# Use apt for pandas/psycopg2 (stable), pip for openpyxl (need >=3.1 for proper xlsx support)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-pandas \
    python3-psycopg2 \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m pip install --no-cache-dir --upgrade pip && \
    python3 -m pip install --no-cache-dir openpyxl==3.1.2

COPY --from=builder /app .

EXPOSE 3000
CMD ["npm","run","start","--","-p","3000","-H","0.0.0.0"]
