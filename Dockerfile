# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/attendance.db

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public

RUN mkdir -p /app/data && chown -R node:node /app

USER node
EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

STOPSIGNAL SIGTERM
CMD ["node", "src/server.js"]
