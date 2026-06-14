# ── Stage 1: build ──────────────────────────
FROM node:20-alpine AS builder
WORKDIR /build
COPY package*.json tsconfig.json tsconfig.build.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

# ── Stage 2: runtime ──────────────────────────
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /build/dist/ ./dist/
COPY skills/ ./skills/
COPY agent.md ./agent.md
EXPOSE 4101
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q -O - http://localhost:4101/health || exit 1
CMD ["node", "dist/server.js"]
