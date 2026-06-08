FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist/ ./dist/
COPY skills/ ./skills/
COPY agent.md ./agent.md
EXPOSE 4101
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q -O - http://localhost:4101/health || exit 1
CMD ["node", "dist/server.js"]
