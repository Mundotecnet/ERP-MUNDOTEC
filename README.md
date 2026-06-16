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
docker compose -f docker-compose.dev.yml up -d        # levanta PostgreSQL 15 en el puerto 5433
docker compose -f docker-compose.dev.yml down         # detiene (mantiene los datos)
docker compose -f docker-compose.dev.yml down -v      # detiene y borra el volumen
```

> Nota: el host de producción ya usa el 5432 para otro PostgreSQL legacy, por eso
> el ERP en dev se mapea a `5433`. Sobreescríbelo con `POSTGRES_HOST_PORT` en `.env`
> si lo necesitas en otra máquina.

La DB se inicializa al primer arranque con `db/erp_schema.sql` (esto es útil cuando
quieres una shadow para comparar). Para arrancar limpia y dejar que Prisma poble el
esquema, haz `down -v` antes del `up`.

## Esquema, migraciones y seed (Prisma)

El núcleo + catálogos base están modelados en `apps/api/prisma/schema.prisma`.
`db/erp_schema.sql` sigue siendo la **fuente de verdad** — el script
`db:check-drift` compara columna a columna las tablas modeladas contra el SQL
canónico y falla si hay drift.

```bash
# Aplicar migraciones (crea/sincroniza la DB con el schema Prisma)
pnpm --filter @mundotec/api db:migrate

# Seed (idempotente): empresa demo, permisos, rol admin, usuario admin
SEED_ADMIN_PASSWORD='tu-password' pnpm --filter @mundotec/api db:seed

# Verificar que el schema Prisma siga alineado con erp_schema.sql
DATABASE_URL='postgres://...' pnpm db:check-drift

# Prisma Studio (UI web para explorar datos)
pnpm --filter @mundotec/api db:studio
```

El usuario admin del seed se crea con `SEED_ADMIN_EMAIL` (default `admin@demo.local`)
y `SEED_ADMIN_PASSWORD` (obligatorio, sin default — define en `.env`).

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

## Auditoría, multi-tenant y RBAC

El cliente Prisma del api se entrega con tres extensiones aplicadas
automáticamente (`apps/api/src/prisma/extensions/`):

- **`audit`** — cada `create / update / upsert / delete` sobre los modelos del
  núcleo registra una fila en `audit_log` con `old_values`, `new_values` y el
  `user_id` activo. El registry de modelos auditables vive en
  `src/prisma/extensions/registry.ts`.
- **`tenant`** — inyecta `where: { companyId }` (o `id` para Company) en
  `findMany / findFirst / count / updateMany / deleteMany` sobre las entidades
  con `company_id`. Si no hay `companyId` en el contexto (seed, migraciones),
  no filtra.
- **`softDelete`** — para los modelos con `deleted_at` (sólo `AppUser` en el
  esquema canónico actual): `delete` se transforma en `update({ deletedAt })` y
  las lecturas filtran `deletedAt: null`. La fila aparece en `audit_log` como
  acción `DELETE` aunque físicamente sea un update.

El contexto del request (`{ userId, companyId }`) se propaga vía
`RequestContextService` con `AsyncLocalStorage.enterWith`. Sprint 1 lo pobla
desde los headers `x-user-id` / `x-company-id` (stub) y consumirá el JWT real
cuando llegue HU-2.x.

Los endpoints declaran permisos requeridos con
`@RequirePermission('código')` (decorador) + `@UseGuards(PermissionsGuard)`.
El guard niega 401 si no hay usuario y 403 si le falta el permiso.

> **Heads up sobre `PrismaPromise` y `AsyncLocalStorage`:** las llamadas a
> Prisma devuelven un thenable propio (`PrismaPromise`) que NO extiende
> `Promise`. `RequestContextService.run` lo detecta vía duck-typing — usar
> `instanceof Promise` rompe el filtro tenant y el audit.

## Tests

| Comando                                        | Qué corre                                                                                                                                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                                    | Unit tests de los workspaces (`*.spec.ts` en `src/`).                                                                                                                                                                     |
| `pnpm --filter @mundotec/api test:integration` | Tests de integración (`*.int.spec.ts` en `apps/api/test/integration`). Usan **`@testcontainers/postgresql`**: cada suite arranca un Postgres efímero, aplica las migraciones Prisma y ejecuta. Requiere Docker corriendo. |

## CI

`.github/workflows/ci.yml` corre en cada PR y push a `main`, en cuatro jobs paralelos:

- **verify**: install → `prisma generate` → format:check → lint → typecheck → build → test (unitarios).
- **docker-api**: `docker build` del api con caché GHA.
- **db-drift**: levanta un PostgreSQL service y corre `pnpm db:check-drift`.
- **integration-tests**: corre `pnpm --filter @mundotec/api test:integration` (testcontainers).

## Autenticación (Sprint 2)

`AuthModule` emite y valida JWT con `@nestjs/jwt`.

```http
POST /auth/login
{ "username": "alice", "password": "Secret123!", "companyId": "1" }
→ 200 { accessToken, refreshToken, user: { id, email, fullName, companyId } }

POST /auth/refresh
{ "refreshToken": "<jwt>" }
→ 200 { accessToken }
```

- `username` acepta usuario o correo. `companyId` solo se requiere si la cuenta existe en más de una empresa.
- Access token: `JWT_ACCESS_EXPIRES_IN` (default 15m). Refresh token: `JWT_REFRESH_EXPIRES_IN` (default 7d).
- Refresh tokens son **stateful**: cada login persiste `refresh_token(jti, token_hash, expires_at, revoked_at)` para que el logout pueda revocarlos.
- Tras `AUTH_MAX_FAILED_ATTEMPTS` (default 5) intentos fallidos seguidos, la cuenta queda bloqueada `AUTH_LOCK_DURATION_MIN` (default 15) minutos → 423 Locked.
- `JwtAuthGuard` es global: TODO endpoint requiere `Authorization: Bearer <accessToken>`. Para excluir explícitamente, decorar con `@Public()`. Hoy son públicos: `GET /`, `GET /health`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`.
- `PermissionsGuard` (`@RequirePermission('código')`) sigue siendo route-level; el `userId` viene del JWT.

```http
POST /auth/logout
{ "refreshToken": "<jwt>" }
→ 204 (idempotente: si el token es inválido o ya está revocado igual responde 204)

POST /auth/change-password   (requiere Bearer)
{ "currentPassword": "...", "newPassword": "..." }
→ 204 (revoca todos los refresh activos del usuario; obliga re-login en cada dispositivo)

POST /auth/forgot-password
{ "username" o "email": "...", "companyId"?: "..." }
→ 204 SIEMPRE (no filtra si la cuenta existe; si existe envía email con un token)

POST /auth/reset-password
{ "token": "<jti>.<secret>", "newPassword": "..." }
→ 204 (token de un solo uso; revoca refresh activos del usuario)
```

### Recuperación de contraseña (HU-2.3)

`forgot-password` genera un token `<jti>.<secret>` (UUID + 32 bytes random), persiste `jti` + `bcrypt(secret)` en `password_reset_token` con `expires_at = now() + RESET_TOKEN_EXPIRES_IN_MIN` (default 60 min) y envía un correo con la URL `MAIL_RESET_URL_BASE?token=<jti.secret>`. `reset-password` busca por `jti`, compara con `bcrypt`, valida la nueva contraseña contra la policy de la empresa y, en una sola transacción, actualiza la password, marca el token como usado y revoca todos los refresh activos.

## Empresa y multiempresa (HU-3.1 + HU-3.3)

Endpoints `CompaniesController`:

```http
GET   /companies/current     (perm company.read)
PATCH /companies/current     (perm company.update)
```

- Sirven la empresa del usuario autenticado vía `@CurrentUser()`. El controller pasa el `companyId` explícito al service — la extensión Prisma `tenant` actúa como red de seguridad si algún flujo futuro lo olvidara.
- El PATCH valida el `taxId` con el helper `normalizeCostaRicaTaxId` (acepta cédulas jurídicas con/sin guiones, físicas, DIMEX y NITE). Cada cambio queda registrado en `audit_log` por la extensión `audit`.

Para evidenciar aislamiento por empresa hay un `BranchesController` mínimo:

```http
GET /branches    (perm branch.read)
```

Devuelve sólo las sucursales de la empresa activa. El CRUD completo de sucursales/almacenes (HU-3.2) entra en Sprint 3.

### Mailer

`MailerService` envía con `nodemailer` y admite dos transportes vía `MAIL_TRANSPORT`:

- `json` (default): `jsonTransport` — el correo no sale al mundo, solo se loguea con Nest Logger y queda disponible para los tests vía `MailerService.getLastJsonMessage()`.
- `smtp`: SMTP real. Requiere `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (y opcionalmente `SMTP_SECURE`).

`MAIL_FROM` es requerido en ambos modos. Producción se enciende cambiando esas vars en `.env`.

### Política de contraseñas (HU-2.4)

Cada empresa puede tener una fila en `password_policy` con `min_length`, `require_upper/lower/digit/special`. Sin fila, se aplican defaults: 10+ caracteres, mayúscula + minúscula + dígito.

`PasswordPolicyService` (en `AuthModule`) valida y se usará desde change-password, creación de usuarios (futuro) y reset (PR-7). El servicio expone `validate(password, policy)` y `validateForCompany(companyId, password)` con mensajes claros en `errors`.

### Notas internas

- En NestJS el contexto del usuario del JWT viaja por **dos canales**: `request.authUser` (para handlers, leído con `@CurrentUser()`) y `RequestContextService.set()` (para que las extensiones Prisma lo vean). `enterWith` del guard no siempre propaga al handler — ver memoria interna del proyecto.

## Estado del Sprint 1

- [x] **PR-1 — HU-1.1**: estructura del monorepo, TypeScript, ESLint/Prettier, README.
- [x] **PR-2 — HU-1.2**: Docker Compose (prod + dev), Dockerfile del api, `/health`, CI.
- [x] **PR-3 — HU-1.3**: Prisma + esquema núcleo + migración inicial + seed + drift check.
- [x] **PR-4 — HU-6.1**: extensiones audit / tenant / softDelete + RBAC + tests de integración.

## Estado del Sprint 2

- [x] **PR-5 — HU-2.1**: login + JWT (access + refresh stateful) + bloqueo por intentos fallidos.
- [x] **PR-6 — HU-2.2 + HU-2.4**: logout (revoca refresh) + change-password + políticas de contraseña por empresa.
- [x] **PR-7 — HU-2.3**: forgot-password + reset-password + MailerService (json/smtp).
- [x] **PR-8 — HU-3.1 + HU-3.3**: CompaniesController, validación cédula CR, BranchesController y e2e de aislamiento.

**Sprint 2 completo** ✓ — Autenticación, multiempresa y aislamiento listos. Próximo: Sprint 3 (HU-4.1–4.4 roles/permisos + HU-3.2 sucursales).

## Convenciones

- TypeScript estricto. `camelCase` en código, `snake_case` en DB (el ORM mapea).
- Commits en español con prefijos `feat:`, `fix:`, `infra:`, `docs:`.
- PRs pequeños y revisables; un módulo NestJS por bounded context cuando empiecen los módulos operativos.
- Nunca commitear `.env` reales ni secretos.
