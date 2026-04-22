# syntax=docker.io/docker/dockerfile:1
#
# Multi-stage: a single `docker build` runs `next build` inside Linux (no host `pnpm build` required),
# so Windows/macOS can deploy with: docker compose -f scripts/compose/docker-compose.yml --profile all up --build
#
# Placeholder NEXT_PUBLIC_* values match scripts/build-local-images.sh; apps/web/docker-entrypoint.sh rewrites at container startup.
#
#   docker build -f apps/web/Dockerfile -t kortix/kortix-frontend:latest .
#
# For CLOUD: pass billing build-arg or bake NEXT_PUBLIC_BILLING_ENABLED=true
#

FROM node:22-slim AS builder
WORKDIR /app

ARG NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=local-build-placeholder-anon-key
ARG NEXT_PUBLIC_BACKEND_URL=http://localhost:8008/v1
ARG NEXT_PUBLIC_BILLING_ENABLED=false
ARG NEXT_PUBLIC_ENV_MODE=local

ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL
ENV NEXT_PUBLIC_BILLING_ENABLED=$NEXT_PUBLIC_BILLING_ENABLED
ENV NEXT_PUBLIC_ENV_MODE=$NEXT_PUBLIC_ENV_MODE
ENV NEXT_TELEMETRY_DISABLED=1
# Do not set NODE_ENV=production before install: pnpm would skip devDependencies (e.g. @tailwindcss/postcss) and `next build` would fail.
ENV NODE_ENV=development

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/web ./apps/web
COPY packages/shared ./packages/shared

RUN corepack enable pnpm && \
    pnpm install --filter ./apps/web... --frozen-lockfile --shamefully-hoist

ENV NODE_ENV=production
RUN pnpm --filter ./apps/web run build

# ── Runtime image (previously host-standalone only) ─────────────────────────
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# License
COPY LICENSE /LICENSE

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

# Remove any .env files from the standalone output — runtime env vars
# (set in docker-compose) must take precedence. Next.js .env files override
# process.env for server components, which breaks local/VPS deploys.
RUN rm -f /app/apps/web/.env /app/apps/web/.env.local /app/apps/web/.env.production /app/.env

# Copy entrypoint script (needs to run as root for VPS URL rewriting)
COPY apps/web/docker-entrypoint.sh /docker-entrypoint.sh
# Windows checkouts may use CRLF; Linux exec fails with "no such file or directory" on the shebang line
RUN sed -i 's/\r$//' /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["/docker-entrypoint.sh"]
