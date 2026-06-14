# MundoTec ERP

ERP web a la medida para MundoTec (retail + servicio técnico B2B en Costa Rica).
Monorepo con backend NestJS, frontends React y microservicio fiscal en FastAPI.

Para contexto de producto, arquitectura y reglas de negocio ver [`CLAUDE.md`](CLAUDE.md).

## Estructura

```
apps/
  api/          Backend NestJS (núcleo + módulos de negocio)
  web-erp/      UI interna del ERP (React + Vite)
  web-store/    Tienda pública (React + Vite)
packages/
  shared/       Tipos y utilidades TypeScript compartidas
services/
  fiscal/       Microservicio FastAPI de factura electrónica CR (pendiente)
db/
  erp_schema.sql  Esquema de referencia (fuente de verdad del modelo)
docs/           Documentación del proyecto
```

## Requisitos

- Node.js **20.x** (usa el `.nvmrc`).
- pnpm **10+**.
- Docker y Docker Compose v2 (para levantar la DB localmente y para build del api).

## Instalación

```bash
cp .env.example .env    # ajusta los valores antes de seguir
pnpm install
```

## Scripts del monorepo (raíz)

| Comando             | Qué hace                               |
| ------------------- | -------------------------------------- |
| `pnpm lint`         | ESLint en todos los workspaces         |
| `pnpm typecheck`    | `tsc --noEmit` en todos los workspaces |
| `pnpm build`        | Build en todos los workspaces          |
| `pnpm test`         | Tests en todos los workspaces          |
| `pnpm format`       | Prettier sobre todo el repo            |
| `pnpm format:check` | Verifica formato sin escribir          |

## Trabajar por workspace

```bash
# Backend (NestJS) — arranca en API_PORT (default 3000); GET /health responde {status:'ok'}.
pnpm --filter @mundotec/api start:dev
pnpm --filter @mundotec/api test

# Frontend ERP (Vite)
pnpm --filter @mundotec/web-erp dev        # http://localhost:5173

# Tienda (Vite)
pnpm --filter @mundotec/web-store dev      # http://localhost:5174
```

## Base de datos local (Docker)

Para desarrollo el api corre en el host y la DB en un contenedor con el puerto expuesto:

```bash
docker compose -f docker-compose.dev.yml up -d        # levanta PostgreSQL 15
docker compose -f docker-compose.dev.yml down         # detiene (mantiene los datos)
docker compose -f docker-compose.dev.yml down -v      # detiene y borra el volumen
```

La DB se inicializa al primer arranque con `db/erp_schema.sql`. Para regenerar el
esquema desde cero usa `down -v` y vuelve a hacer `up`.

## Stack de producción (Docker Compose)

`docker-compose.yml` es la referencia de producción. La DB queda en red interna sin
puertos expuestos y los servicios opcionales viven detrás de _profiles_:

```bash
docker compose up -d                                  # núcleo: db + api
docker compose --profile frontend up -d               # añade web-erp + web-store
docker compose --profile edge up -d                   # añade nginx + certbot
docker compose --profile fiscal up -d                 # añade microservicio fiscal (pendiente)
```

El `Dockerfile` del api (`apps/api/Dockerfile`) es multi-stage: instala con pnpm,
compila con `nest build` y sirve con `node dist/main.js` desde un usuario no-root.
Trae `HEALTHCHECK` contra `GET /health`.

## CI

`.github/workflows/ci.yml` corre en cada PR y push a `main`:

1. `pnpm install --frozen-lockfile`
2. `pnpm format:check`
3. `pnpm lint`
4. `pnpm typecheck`
5. `pnpm build`
6. `pnpm test`
7. `docker build` del api (cacheado con GHA cache)

## Estado del Sprint 1

- [x] **PR-1 — HU-1.1**: estructura del monorepo, TypeScript, ESLint/Prettier, README.
- [x] **PR-2 — HU-1.2**: Docker Compose (prod + dev), Dockerfile del api, `/health`, CI.
- [ ] PR-3 — HU-1.3: Prisma + esquema núcleo + migración inicial + seed.
- [ ] PR-4 — HU-6.1: interceptor de auditoría + ganchos para multiempresa, soft-delete y RBAC.

## Convenciones

- TypeScript estricto. `camelCase` en código, `snake_case` en DB (el ORM mapea).
- Commits en español con prefijos `feat:`, `fix:`, `infra:`, `docs:`.
- PRs pequeños y revisables; un módulo NestJS por bounded context cuando empiecen los módulos operativos.
- Nunca commitear `.env` reales ni secretos.
