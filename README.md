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
- Docker y Docker Compose (para PR-2 en adelante; aún no requerido en PR-1).

## Instalación

```bash
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
# Backend (NestJS)
pnpm --filter @mundotec/api start:dev      # arranca en API_PORT (default 3000)
pnpm --filter @mundotec/api test

# Frontend ERP (Vite)
pnpm --filter @mundotec/web-erp dev        # http://localhost:5173

# Tienda (Vite)
pnpm --filter @mundotec/web-store dev      # http://localhost:5174
```

## Estado del Sprint 1

- [x] **PR-1 — HU-1.1**: estructura del monorepo, TypeScript, ESLint/Prettier, README.
- [ ] PR-2 — HU-1.2: Docker Compose + CI (GitHub Actions) + `.env.example` ampliado.
- [ ] PR-3 — HU-1.3: Prisma + esquema núcleo + migración inicial + seed.
- [ ] PR-4 — HU-6.1: interceptor de auditoría + ganchos para multiempresa, soft-delete y RBAC.

## Convenciones

- TypeScript estricto. `camelCase` en código, `snake_case` en DB (el ORM mapea).
- Commits en español con prefijos `feat:`, `fix:`, `infra:`, `docs:`.
- PRs pequeños y revisables; un módulo NestJS por bounded context cuando empiecen los módulos operativos.
- Nunca commitear `.env` reales ni secretos.
