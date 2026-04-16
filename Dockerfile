# ════════════════════════════════════════════════════════════
#  PayFlow — Dockerfile
#  Multi-stage: deps → prod image
# ════════════════════════════════════════════════════════════

# ── Stage 1: Install dependencies ────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# ── Stage 2: Production image ─────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy installed deps from stage 1
COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY . .

# Non-root user for security
RUN addgroup -S payflow && adduser -S payflow -G payflow
USER payflow

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "server.js"]
