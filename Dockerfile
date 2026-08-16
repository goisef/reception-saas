# syntax=docker/dockerfile:1
#
# Cloud Run 向けのコンテナイメージ (PRD 13-1)。
#
# next.config.ts の output: 'standalone' が吐く最小構成だけを実行段へ持ち込み、
# ビルドツールとソースをイメージに残さない。攻撃面を減らすのと、
# コールドスタートを短くするのが目的。

# ---------------------------------------------------------------------------
# 依存解決
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# 開発依存も要る。next build に typescript / eslint-config-next が必要なため
RUN npm ci

# ---------------------------------------------------------------------------
# ビルド
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------------------------------------------------------------------------
# 実行
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Cloud Run は PORT を注入する。ローカル実行時の既定として 8080 を置く
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

# root で動かさない
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# standalone は public と .next/static を含まないので個別に持ってくる
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# /api/v1/openapi が実行時に読むので同梱する
COPY --from=builder --chown=nextjs:nodejs /app/openapi ./openapi

USER nextjs
EXPOSE 8080

# Cloud Run はヘルスチェックを外側で行うが、ローカル/K8s 用に入れておく
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
