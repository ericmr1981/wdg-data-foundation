# syntax=docker/dockerfile:1

# Use Debian-based image to make Python deps (pandas/openpyxl) manageable.
FROM node:20-bullseye-slim AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bullseye-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-bullseye-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Python runtime for import scripts triggered by /api/upload
# Prefer Debian packages over pip to reduce external download failures.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    python3-pandas \
    python3-openpyxl \
    python3-psycopg2 \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app .

EXPOSE 3000
CMD ["npm","run","start","--","-p","3000","-H","0.0.0.0"]
