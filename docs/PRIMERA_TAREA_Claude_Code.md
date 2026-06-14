# Primera tarea para Claude Code (Sprint 1 — Fundación)

Copia este texto como primer mensaje a Claude Code (ya con el repo abierto y este pack dentro).

---

Lee `CLAUDE.md`, `/db/erp_schema.sql` y `/docs/backlog-fase1.md`. Vamos a iniciar el **Sprint 1** de la Fase 1.
Stack: Node + NestJS + TypeScript (backend), React + TypeScript (frontend), PostgreSQL, Docker. No implementes
módulos de negocio todavía; solo la fundación.

Quiero que en este sprint:

1. **HU-1.1 — Estructura base del proyecto.** Crea el monorepo según la estructura de `CLAUDE.md`
   (`apps/api`, `apps/web-erp`, `apps/web-store`, `packages/shared`, `db/`, `docs/`). Configura TypeScript,
   ESLint/Prettier, y un README con cómo correr el proyecto.

2. **HU-1.2 — Entorno y CI.** Crea `docker-compose.yml` con PostgreSQL y el backend. Configura un pipeline
   de CI que instale, haga build y corra pruebas. Deja variables de entorno en `.env.example` (sin secretos reales).

3. **HU-1.3 — Migraciones desde el esquema.** Elige el ORM (Prisma o TypeORM) y crea las migraciones iniciales
   a partir de `/db/erp_schema.sql`, empezando por el núcleo: `company`, `branch`, `app_user`, `role`,
   `permission`, `role_permission`, `user_role`, `audit_log`, y los catálogos base (`currency`, `exchange_rate`,
   `tax`, `unit_of_measure`, `department`, `product_category`, `customer_category`). Incluye un seed con una
   empresa demo, un usuario admin y permisos base.

4. **HU-6.1 — Auditoría.** Implementa un interceptor que registre altas/cambios/bajas en `audit_log`
   (valores antes/después en JSON).

Reglas que debes respetar desde el inicio (ver `CLAUDE.md`): multiempresa (filtra todo por `company_id`),
soft-delete con `deleted_at`, y dejar preparado el punto donde se valida el permiso por endpoint (RBAC).

Trabaja en ramas y entrégame los cambios en PRs pequeños y revisables. Antes de programar, propón el plan
y la elección de ORM; espera mi visto bueno y continúa.

---

## Sprints siguientes (referencia, no para ahora)

- Sprint 2: autenticación (HU-2.1–2.4) y multiempresa (HU-3.1, HU-3.3).
- Sprint 3: roles/permisos (HU-4.1–4.4) y sucursales/almacenes (HU-3.2).
- Sprint 4: catálogos (HU-5.1–5.5), shell de la app (HU-6.2) y parámetros (HU-6.3).
