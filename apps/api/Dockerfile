# syntax=docker/dockerfile:1.7
# Build context: monorepo root (no apps/api). Ver docker-compose.yml.
ARG NODE_VERSION=20-slim

# ----------------------------------------------------------------------------
# Stage 0 — base con pnpm activado vía corepack.
# ----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm \
    PATH="/pnpm:${PATH}" \
    CI=true
RUN corepack enable && corepack prepare pnpm@10.34.3 --activate
WORKDIR /repo

# ----------------------------------------------------------------------------
# Stage 1 — instala TODAS las deps del workspace api (incluye dev) para build.
# El postinstall del api corre `prisma generate`, pero en esta etapa aún no
# hemos copiado el schema, así que sólo emite warning. Lo generamos explícito
# en el siguiente stage tras copiar las fuentes.
# ----------------------------------------------------------------------------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter '@mundotec/api...' --ignore-scripts

# ----------------------------------------------------------------------------
# Stage 2 — compila el api (apps/api/dist) y genera el cliente Prisma.
# ----------------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY apps/api/ apps/api/
RUN pnpm --filter @mundotec/api exec prisma generate
RUN pnpm --filter @mundotec/api build

# ----------------------------------------------------------------------------
# Stage 3 — runtime mínimo con sólo deps de producción.
# ----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production \
    API_PORT=3000 \
    PNPM_HOME=/pnpm \
    PATH="/pnpm:${PATH}"
# openssl + ca-certificates: Prisma 5 los necesita para detectar la versión de
# libssl en runtime y cargar el binario correcto (sin esto cae al binario
# openssl-1.1.x que no existe en Debian 12/Bookworm).
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.34.3 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
# --ignore-scripts: el postinstall del api (prisma generate) no puede correr aquí
# porque `prisma` (CLI) es devDep y no está en --prod. Copiamos el cliente ya
# generado desde el stage de build justo después de este install.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter '@mundotec/api...' --ignore-scripts
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/packages/shared/src packages/shared/src
# Cliente Prisma generado por el build stage. El path incluye la versión exacta
# de @prisma/client; cuando actualices Prisma, ajusta el sufijo de la ruta.
COPY --from=build \
    /repo/node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma \
    /app/node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma
RUN groupadd --system --gid 1001 api \
    && useradd --system --uid 1001 --gid api -d /app -s /usr/sbin/nologin api \
    && chown -R api:api /app
USER api
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.API_PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
WORKDIR /app/apps/api
CMD ["node", "dist/main.js"]
