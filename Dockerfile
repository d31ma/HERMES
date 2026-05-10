# syntax=docker/dockerfile:1.7

# ── Build stage: install dependencies and strip test routes ──────────────────
FROM oven/bun:1.3.11@sha256:0733e50325078969732ebe3b15ce4c4be5082f18c4ac1a0f0ca4839c2e4e42a7 AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY browser ./browser
COPY server ./server
COPY scripts/entry.mjs ./scripts/
COPY scripts/create-admin.mjs ./scripts/
COPY scripts/migrate-domain.mjs ./scripts/
COPY jsconfig.json ./jsconfig.json

# Remove test routes — they should never be in production
RUN rm -rf server/routes/test

# Pre-create data directory structure (distroless has no shell for RUN)
RUN mkdir -p /data /data/attachments && chown 65532:65532 /data /data/attachments

# ── Runtime: distroless Bun — minimal attack surface ─────────────────────────
FROM oven/bun:1.3.11-distroless@sha256:6a78966e057efd546873b64d6c173b18a21a10c3da81562863beeaf044c1e2ec

COPY --from=builder --chown=65532:65532 /app /app
COPY --from=builder --chown=65532:65532 /data /data

WORKDIR /app
USER 65532:65532

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    FYLO_ROOT=/data \
    ATTACHMENT_ROOT=/data/attachments

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD ["/usr/local/bin/bun","-e","const r=await fetch('http://127.0.0.1:'+(process.env.PORT||'8080')+'/health');process.exit(r.ok?0:1)"]

ENTRYPOINT ["/usr/local/bin/bun", "scripts/entry.mjs"]
CMD []
