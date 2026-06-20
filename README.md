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

### Hook pre-push (husky)

Tras `pnpm install`, husky instala `.husky/pre-push` automáticamente. Antes de cada `git push` se corre **exactamente** el pipeline del job `verify`:

```text
pnpm install --frozen-lockfile
pnpm --filter @mundotec/api exec prisma generate
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

Si algo falla, el push se aborta. Equivalente desde el shell: `pnpm ci:verify`. Para saltarse el hook excepcionalmente (no recomendado): `git push --no-verify`.

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

## Sucursales y almacenes (HU-3.2)

```http
GET    /branches                (perm branch.read)
GET    /branches/:id             (perm branch.read)
POST   /branches                 (perm branch.create)
PATCH  /branches/:id             (perm branch.update)
DELETE /branches/:id             (perm branch.delete)

GET    /warehouses               (perm warehouses.read)
GET    /warehouses/:id           (perm warehouses.read)
POST   /warehouses               (perm warehouses.create)
PATCH  /warehouses/:id           (perm warehouses.update)
DELETE /warehouses/:id           (perm warehouses.delete)
```

- `code` único por empresa en ambos modelos (P2002 → 409). `name` requerido.
- Sucursal y almacén filtran por la empresa del JWT; intentar leer/editar/borrar uno de otra empresa devuelve 404.
- `Warehouse.branchId` es opcional. Al asignarlo, el service verifica que la sucursal sea de la **misma empresa**; si no, 400.
- `DELETE /branches/:id` bloquea con **409** si la sucursal tiene almacenes asociados — desasocia o elimina los almacenes primero.
- Cada mutación queda registrada en `audit_log` con el `userId` real vía la extensión Prisma `audit`.

## Usuarios (HU-4.1)

`UsersController` ofrece CRUD básico de `app_user` filtrado por la empresa del JWT:

```http
GET    /users?page=1&pageSize=20   (perm users.read)
GET    /users/:id                  (perm users.read)
POST   /users                      (perm users.create)
PATCH  /users/:id                  (perm users.update)
DELETE /users/:id                  (perm users.delete)
```

- POST y PATCH (cuando incluyen `password`) validan contra el `PasswordPolicyService` de la empresa.
- Marca de vendedor (`isSalesperson`) y `commissionPct` ∈ [0, 1] cubren HU-4.1.
- DELETE es **soft-delete** (la extensión `softDelete` convierte el `delete` en `update deletedAt = now()`); el row físico queda y el `audit_log` lo registra como `DELETE`.
- Cuando un admin cambia la `password` de otro usuario vía PATCH, se revoca todos los refresh activos de ese usuario (re-login forzado en cada dispositivo).
- Conflicto de username/email → 409. Lookup de user de otra empresa → 404.

## Estado del Sprint 3

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

**Sprint 2 completo** ✓ — Autenticación, multiempresa y aislamiento listos.

## Asignación de roles a usuarios (HU-4.3)

```http
PUT /users/:id/roles    (perm users.assign-roles)
{ "roleIds": ["1", "5"] }
```

Reemplaza el **set completo** de roles del usuario en una transacción Prisma (`userRole.deleteMany` + `createMany`). Sólo acepta roles de la misma empresa; un id de otra empresa devuelve **400**. `[]` quita todos los roles.

**Efecto inmediato**: `PermissionsGuard` consulta `permission → role_permission → role → user_role` en cada request, así que asignar o quitar un rol cambia el comportamiento de RBAC desde el siguiente request del usuario afectado, sin re-login.

Permiso separado `users.assign-roles` (no `users.update`) para granularidad: un admin puede editar usuarios sin escalar privilegios.

## Matriz endpoint → permiso (HU-4.4, cobertura)

| Endpoint                   | Método | `@Public()` | Permiso requerido                               |
| -------------------------- | ------ | ----------- | ----------------------------------------------- |
| `/`                        | GET    | ✓           | —                                               |
| `/health`                  | GET    | ✓           | —                                               |
| `/auth/login`              | POST   | ✓           | —                                               |
| `/auth/refresh`            | POST   | ✓           | —                                               |
| `/auth/logout`             | POST   | ✓           | —                                               |
| `/auth/forgot-password`    | POST   | ✓           | —                                               |
| `/auth/reset-password`     | POST   | ✓           | —                                               |
| `/auth/change-password`    | POST   | —           | (sólo Bearer; no requiere `@RequirePermission`) |
| `/companies/current`       | GET    | —           | `company.read`                                  |
| `/companies/current`       | PATCH  | —           | `company.update`                                |
| `/branches`                | GET    | —           | `branch.read`                                   |
| `/branches/:id`            | GET    | —           | `branch.read`                                   |
| `/branches`                | POST   | —           | `branch.create`                                 |
| `/branches/:id`            | PATCH  | —           | `branch.update`                                 |
| `/branches/:id`            | DELETE | —           | `branch.delete`                                 |
| `/currencies`              | GET    | —           | `catalogs.currency.read`                        |
| `/currencies/:code`        | GET    | —           | `catalogs.currency.read`                        |
| `/currencies`              | POST   | —           | `catalogs.currency.manage`                      |
| `/currencies/:code`        | PATCH  | —           | `catalogs.currency.manage`                      |
| `/currencies/:code`        | DELETE | —           | `catalogs.currency.manage`                      |
| `/exchange-rates`          | GET    | —           | `catalogs.exchange-rate.read`                   |
| `/exchange-rates/convert`  | GET    | —           | `catalogs.exchange-rate.read`                   |
| `/exchange-rates/:id`      | GET    | —           | `catalogs.exchange-rate.read`                   |
| `/exchange-rates`          | POST   | —           | `catalogs.exchange-rate.manage`                 |
| `/exchange-rates/:id`      | PATCH  | —           | `catalogs.exchange-rate.manage`                 |
| `/exchange-rates/:id`      | DELETE | —           | `catalogs.exchange-rate.manage`                 |
| `/taxes`                   | GET    | —           | `catalogs.tax.read`                             |
| `/taxes/:id`               | GET    | —           | `catalogs.tax.read`                             |
| `/taxes`                   | POST   | —           | `catalogs.tax.manage`                           |
| `/taxes/:id`               | PATCH  | —           | `catalogs.tax.manage`                           |
| `/taxes/:id`               | DELETE | —           | `catalogs.tax.manage`                           |
| `/units-of-measure`        | GET    | —           | `catalogs.uom.read`                             |
| `/units-of-measure/:id`    | GET    | —           | `catalogs.uom.read`                             |
| `/units-of-measure`        | POST   | —           | `catalogs.uom.manage`                           |
| `/units-of-measure/:id`    | PATCH  | —           | `catalogs.uom.manage`                           |
| `/units-of-measure/:id`    | DELETE | —           | `catalogs.uom.manage`                           |
| `/departments`             | GET    | —           | `catalogs.department.read`                      |
| `/departments/:id`         | GET    | —           | `catalogs.department.read`                      |
| `/departments`             | POST   | —           | `catalogs.department.manage`                    |
| `/departments/:id`         | PATCH  | —           | `catalogs.department.manage`                    |
| `/departments/:id`         | DELETE | —           | `catalogs.department.manage`                    |
| `/product-categories`      | GET    | —           | `catalogs.product-category.read`                |
| `/product-categories/:id`  | GET    | —           | `catalogs.product-category.read`                |
| `/product-categories`      | POST   | —           | `catalogs.product-category.manage`              |
| `/product-categories/:id`  | PATCH  | —           | `catalogs.product-category.manage`              |
| `/product-categories/:id`  | DELETE | —           | `catalogs.product-category.manage`              |
| `/customer-categories`     | GET    | —           | `catalogs.customer-category.read`               |
| `/customer-categories/:id` | GET    | —           | `catalogs.customer-category.read`               |
| `/customer-categories`     | POST   | —           | `catalogs.customer-category.manage`             |
| `/customer-categories/:id` | PATCH  | —           | `catalogs.customer-category.manage`             |
| `/customer-categories/:id` | DELETE | —           | `catalogs.customer-category.manage`             |
| `/params`                  | GET    | —           | `params.read`                                   |
| `/params/:key`             | GET    | —           | `params.read`                                   |
| `/params/:key`             | PUT    | —           | `params.manage`                                 |
| `/params/:key`             | DELETE | —           | `params.manage`                                 |
| `/warehouses`              | GET    | —           | `warehouses.read`                               |
| `/warehouses/:id`          | GET    | —           | `warehouses.read`                               |
| `/warehouses`              | POST   | —           | `warehouses.create`                             |
| `/warehouses/:id`          | PATCH  | —           | `warehouses.update`                             |
| `/warehouses/:id`          | DELETE | —           | `warehouses.delete`                             |
| `/users`                   | GET    | —           | `users.read`                                    |
| `/users/:id`               | GET    | —           | `users.read`                                    |
| `/users`                   | POST   | —           | `users.create`                                  |
| `/users/:id`               | PATCH  | —           | `users.update`                                  |
| `/users/:id`               | DELETE | —           | `users.delete`                                  |
| `/users/:id/roles`         | PUT    | —           | `users.assign-roles`                            |
| `/roles`                   | GET    | —           | `roles.read`                                    |
| `/roles/:id`               | GET    | —           | `roles.read`                                    |
| `/roles`                   | POST   | —           | `roles.create`                                  |
| `/roles/:id`               | PATCH  | —           | `roles.update`                                  |
| `/roles/:id`               | DELETE | —           | `roles.delete`                                  |
| `/roles/:id/permissions`   | PUT    | —           | `roles.update`                                  |
| `/permissions`             | GET    | —           | `permissions.read`                              |

Cobertura: el `JwtAuthGuard` global rechaza con 401 a quien no traiga `Bearer`; el `PermissionsGuard` rechaza con 403 a quien no tenga el permiso declarado. Para endpoints públicos, decora con `@Public()`.

## Roles y permisos (HU-4.2)

`RolesController` ofrece CRUD de roles por empresa + un endpoint para reemplazar el set completo de permisos:

```http
GET    /roles?page=1&pageSize=20   (perm roles.read)
GET    /roles/:id                  (perm roles.read)
POST   /roles                      (perm roles.create)
PATCH  /roles/:id                  (perm roles.update)
DELETE /roles/:id                  (perm roles.delete)
PUT    /roles/:id/permissions      (perm roles.update)   body: { permissionCodes: string[] }
```

- `DELETE` **bloquea con 409** si el rol está asignado a uno o más usuarios — quita la asignación primero (en PR-11 entra el endpoint para gestionarlo).
- `PUT /permissions` reemplaza el set completo en una transacción Prisma. Valida que todos los `permissionCodes` existan en el catálogo antes de aplicar; si falta alguno, devuelve 400 con la lista de códigos inexistentes.
- Nombres de rol son únicos por empresa (`UNIQUE (company_id, name)`); duplicado → 409.

`PermissionsController` expone el catálogo de permisos del sistema:

```http
GET /permissions   (perm permissions.read)
```

Es **solo lectura** — nuevos códigos entran vía seed/migración, no por API.

## Estado del Sprint 3

- [x] **PR-9 — HU-4.1**: Users CRUD (POST/GET/PATCH/DELETE) + marca de vendedor + soft-delete + revocación de refresh al cambiar password + `RequestContextInterceptor` global.
- [x] **PR-10 — HU-4.2**: Roles CRUD + `PUT /roles/:id/permissions` (replace set) + GET /permissions catálogo.
- [x] **PR-11 — HU-4.3 + HU-4.4**: `PUT /users/:id/roles` con permiso `users.assign-roles`, efecto inmediato verificado y matriz endpoint→permiso documentada.
- [x] **PR-12 — HU-3.2**: Branches CRUD completo + Warehouses CRUD con asociación opcional a sucursal (bloqueo cross-tenant) + DELETE branch con almacenes asociados bloqueado.

**Sprint 3 completo** ✓ — Roles/permisos, usuarios, sucursales y almacenes listos.

## Estado del Sprint 4

- [x] **PR-13 — HU-5.1 + 5.2 + 5.3**: Currencies, ExchangeRates, Taxes, UnitsOfMeasure.
- [x] **PR-14 — HU-5.4 + 5.5**: Departments + ProductCategories jerárquicas + CustomerCategories.
- [x] **PR-15 — HU-6.3**: Parámetros generales (tabla `company_param` + CRUD upsert).
- [x] **PR-16 — HU-6.2**: Shell frontend `web-erp` (login + routing + AuthProvider + layout con menú dinámico por permisos + páginas mínimas).

**Sprint 4 completo** ✓ — Catálogos, parámetros y shell de UI listos. **Fase 1 cerrada**.

## Estado del Sprint 5 (Fase 2)

Ver [`docs/backlog-fase2.md`](docs/backlog-fase2.md) para el plan completo de la Fase 2.

- [x] **PR-18 — HU-7.1**: Backend de productos (modelo `product` + CRUD + soft-delete + validación cruzada de FKs + permisos `catalogs.product.read/manage`).
- [x] **PR-19 — HU-7.2 + HU-7.3**: Endpoint read-only `GET /stock` con filtros (modelo `Stock` + permiso `inventory.stock.read`) y páginas `/products` (CRUD desde UI) y `/stock` (lectura filtrable) en `web-erp`.

**Sprint 5 completo** ✓ — Catálogo de productos administrable desde la UI y stock-snapshot disponible.

## Estado del Sprint 6 (Fase 2 — Inventario / Kardex)

- [x] **PR-20 — HU-8.1 + HU-8.2**: Movimientos de inventario (modelo `StockMovement` + `POST /stock-movements` con transacción Prisma y costo promedio ponderado, `GET /stock-movements` con filtros). Permisos `inventory.movement.read/manage`.
- [x] **PR-21 — HU-8.3**: Transferencias entre almacenes (`POST /stock-movements/transfer` — OUT+IN atómicos con `source_id` cruzado y `source_doc='TRANSFER'`; el `unit_cost` del par hereda el `avg_cost` del origen).
- [x] **PR-22 — HU-8.4**: UI `/movements` con tabs **Nuevo movimiento** (IN/OUT/ADJUST con CPP) · **Transferencia** (validación origen ≠ destino client-side) · **Kardex** con filtros producto/almacén/fecha.

**Sprint 6 completo** ✓ — Kardex con CPP, transferencias atómicas y UI integrada.

## Estado del Sprint 7 (Fase 2 — Compras)

- [x] **PR-23 — HU-9.1**: Terceros (modelo `Partner` + `PartnerContact` con cascade; CRUD con filtro por tipo `CUSTOMER`/`SUPPLIER`/`BOTH` y búsqueda `?q=`; CRUD de contactos). Permisos `partners.read/manage`.
- [x] **PR-24 — HU-9.2**: Órdenes de compra (`PurchaseOrder` + `PurchaseOrderLine`, cascade líneas, totales server-side `subtotal/tax_amount/total/base_total`, multi-moneda con `exchange_rate`, transiciones `DRAFT → APPROVED → CANCELLED`, `POST /purchase-orders/:id/approve` y `/cancel`). Permisos `purchases.po.read/manage`.
- [x] **PR-25 — HU-9.3**: Recepciones (`GoodsReceipt` + `GoodsReceiptLine`, `POST /goods-receipts` atómico que genera `StockMovement` IN por línea con `sourceDoc='RECEIPT'`, avanza `received_qty` de las líneas de OC con FIFO por producto, y mueve la OC a `RECEIVED` cuando se completa). Permisos `purchases.receipt.read/manage`.
- [ ] PR-26 — HU-9.4: UI Compras.

## Frontend `web-erp` (HU-6.2)

Shell de la aplicación interna construido con React 18 + Vite + Tailwind CSS + shadcn-style primitives + react-router-dom 6 + TanStack Query 5 + react-hook-form + zod + axios.

```bash
pnpm --filter @mundotec/web-erp dev      # http://localhost:5173 (proxy a /api → http://localhost:3000)
pnpm --filter @mundotec/web-erp build
pnpm --filter @mundotec/web-erp test     # vitest (jsdom + Testing Library)
```

Para desarrollo local: levanta primero el backend (`pnpm --filter @mundotec/api start:dev`) y luego el frontend. El proxy de Vite redirige `/api/*` a `http://localhost:3000` (override con `VITE_API_BASE_URL`).

### Lo que entrega

- **`POST /auth/login`** desde `/login` con react-hook-form + zod. Persiste access/refresh tokens en `localStorage`. Al iniciar la app revalida la sesión con `GET /auth/me`.
- **`GET /auth/me`** (endpoint nuevo en el backend) devuelve `{ id, email, username, fullName, companyId, permissions[] }`. El frontend lo consume para armar el menú dinámico.
- **`ProtectedRoute`** redirige a `/login` si no hay sesión; rechaza con "Sin permiso" si el usuario está logueado pero le falta el permiso declarado en la ruta.
- **`Shell` layout**: sidebar con menú **filtrado por permisos** (`NAV_ENTRIES` + `hasPermission`), header con datos del usuario y botón de logout.
- **Páginas read-only** sobre los endpoints existentes: Dashboard (`/companies/current`), Sucursales (`/branches`), Usuarios (`/users`), Roles (`/roles`), Monedas (`/currencies`), Configuración (`/params`). El CRUD desde UI llega en sprints posteriores.
- **Refresh automático**: interceptor `axios` captura 401, llama `POST /auth/refresh`, reintenta el request original; si falla, limpia la sesión y vuelve a `/login`.

### Tests

`vitest` con `jsdom` + `@testing-library/react`. 9 tests cubren: validación del formulario de login, llamadas al `login()` con el payload correcto, redirección si ya hay sesión, `ProtectedRoute` redirige sin auth y filtra por permiso, `Shell` muestra/oculta entradas según permisos.

## Catálogos base (HU-5.1, 5.2, 5.3)

Backend del Sprint 4. Se distingue **global** (sin `company_id`) de **per-tenant** (con `company_id`):

| Catálogo       | Scope      | Endpoints                                                                      | Notas                                                                                                                                      |
| -------------- | ---------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Currencies     | global     | `GET/POST/GET:code/PATCH/DELETE /currencies`                                   | PK ISO-4217. DELETE bloquea con 409 si está referenciada por `company` o `exchange_rate`.                                                  |
| ExchangeRates  | global     | `GET/POST/GET:id/PATCH/DELETE /exchange-rates` + `GET /exchange-rates/convert` | UNIQUE (currencyCode, rateDate). Helper de conversión usa el rate vigente (`<= date`); `from === to` devuelve 1; sin tasa aplicable → 404. |
| Taxes          | per-tenant | `GET/POST/GET:id/PATCH/DELETE /taxes`                                          | `rate` ∈ [0, 1]. Cross-tenant → 404.                                                                                                       |
| UnitsOfMeasure | global     | `GET/POST/GET:id/PATCH/DELETE /units-of-measure`                               | `code` único, normalizado a mayúsculas, admite `[A-Z0-9_-]`.                                                                               |

## Catálogos jerárquicos y categoría de cliente (HU-5.4, 5.5)

Tres catálogos **per-tenant** que completan la fase de catálogos del backend:

| Catálogo           | Endpoints                                           | Notas                                                                                                                                                                                              |
| ------------------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Departments        | `GET/POST/GET:id/PATCH/DELETE /departments`         | UNIQUE (`company_id`, `name`). Duplicado → 409.                                                                                                                                                    |
| ProductCategories  | `GET/POST/GET:id/PATCH/DELETE /product-categories`  | **Jerárquico** con `parentId` opcional. Auto-referencia → 400. Cambio que formaría ciclo → 400 (detección con cursor ascendente). Parent de otra empresa → 400. DELETE 409 si tiene subcategorías. |
| CustomerCategories | `GET/POST/GET:id/PATCH/DELETE /customer-categories` | `code` VARCHAR(5) normalizado a mayúsculas (`[A-Z0-9]{1,5}`). UNIQUE (`company_id`, `code`).                                                                                                       |

## Parámetros generales (HU-6.3)

Configuración key/value por empresa. PK compuesta `(company_id, key)`; `value` es JSONB y admite cualquier JSON (strings, numbers, booleans, null, objects, arrays). Pensado para prefijos de documentos, formatos, flags de features y cualquier ajuste que no merezca su propia tabla.

```http
GET    /params           (perm params.read)    → lista todos los params de la empresa
GET    /params/:key      (perm params.read)    → 404 si no existe
PUT    /params/:key      (perm params.manage)  → upsert
DELETE /params/:key      (perm params.manage)  → 204 / 404
```

- `key` debe empezar con minúscula, máximo 80 chars, sólo `[a-z0-9._-]` (`format.date`, `documents.invoice.prefix`, `feature.crm.enabled`). Mayúsculas o chars fuera → 400.
- `value` aceptado tal cual; falta de campo → 400. Persistido en JSONB.
- Aislamiento por empresa del JWT. El endpoint no permite cruzar empresas.

Próximo: Sprint 4 continúa con parámetros (HU-6.3) y shell frontend (HU-6.2).

## Convenciones

- TypeScript estricto. `camelCase` en código, `snake_case` en DB (el ORM mapea).
- Commits en español con prefijos `feat:`, `fix:`, `infra:`, `docs:`.
- PRs pequeños y revisables; un módulo NestJS por bounded context cuando empiecen los módulos operativos.
- Nunca commitear `.env` reales ni secretos.
