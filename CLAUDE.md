# MundoTec ERP — Guía del proyecto (CLAUDE.md)

> Este archivo es el contexto principal para Claude Code. Léelo antes de programar.
> Trabaja en tareas acotadas (un sprint / una historia a la vez), no intentes construir todo de una vez.

## 1. Qué es

ERP web a la medida para MundoTec (retail + servicio técnico B2B en Costa Rica), construido **desde cero**.
Reemplaza/consolida los sistemas actuales (Reportes-Syma y la tienda Mundotec-web) e incorpora sus
funcionalidades mejoradas. Incluye: inventario/compras, cotizaciones, ventas/POS, CRM con tickets,
taller, contabilidad, factura electrónica de Costa Rica y tienda en línea.

## 2. Arquitectura (Modelo A — plataforma unificada)

- **Un solo backend** (monolito modular) + **una sola base de datos PostgreSQL** = fuente única de verdad.
- **Tres frontends** sobre ese backend: tienda web (público), ERP web (interno), POS/móvil.
- La **tienda es un módulo/servicio** sobre los mismos datos; NO tiene base propia ni duplica catálogo/inventario.
- Backend y base de datos viven en **red privada**. La tienda pública accede solo por una **capa pública (BFF)**
  de alcance reducido (catálogo, precios, pedidos), con WAF, rate limiting, caché y usuario de DB de permisos mínimos.
- **Microservicio fiscal** aparte para la factura electrónica (firma XAdES + API de Hacienda/TRIBU-CR).

## 3. Stack

- Backend/API: **Node.js + NestJS + TypeScript** (modular por bounded context).
- Frontends: **React + TypeScript** (web-erp y web-store).
- Base de datos: **PostgreSQL 15+**. ORM: Prisma o TypeORM (elegir uno y mantenerlo).
- Auth: **JWT + refresh tokens**; RBAC por permisos.
- Microservicio fiscal: **Python + FastAPI** (firma XAdES-EPES con xmlsec/lxml).
- Infra: **Docker** + CI/CD.

## 4. Estructura de repositorio (propuesta, monorepo)

```
/apps
  /api          NestJS — backend modular (núcleo + módulos de negocio)
  /web-erp      React — UI interna del ERP
  /web-store    React — tienda pública (storefront)
/services
  /fiscal       FastAPI — microservicio de factura electrónica CR
/packages
  /shared       Tipos y utilidades TypeScript compartidas
/db
  erp_schema.sql   Esquema de referencia (fuente de verdad del modelo)
  /migrations      Migraciones versionadas
/docs            Documentación (ver carpeta)
docker-compose.yml
CLAUDE.md
```

## 5. Modelo de datos

- La fuente de verdad del modelo es **/db/erp_schema.sql** (PostgreSQL, ~99 tablas, 20 vistas).
- Convención de DB: `snake_case`, claves primarias `BIGINT IDENTITY`, importes `NUMERIC(18,4)`.
- Las migraciones deben derivarse de ese esquema; no modificar el modelo sin actualizar el esquema y los docs.

## 6. Reglas de negocio transversales (IMPORTANTES)

- **Multiempresa (multi-tenant):** toda entidad referencia `company_id`. TODA consulta filtra por la empresa del usuario.
  Nunca devolver datos de otra empresa.
- **Multimoneda:** cada empresa tiene moneda base; los documentos guardan moneda, tipo de cambio e importe en moneda base.
- **Soft-delete:** usar `deleted_at` (NULL = activo) en entidades maestras; no borrar físicamente.
- **Auditoría:** registrar altas/cambios/bajas de entidades clave (tabla `audit_log`).
- **RBAC:** cada endpoint valida un permiso (p. ej. `sales.invoice.create`). Sin permiso → 403.
- **Frontera ERP vs. tienda:** catálogo/precios/stock/pedidos/pagos = dominio compartido del ERP;
  login web (`web_customer`), carrito (`cart`), wishlist y contenido (`web_project`, `web_service`, `web_banner`) = solo tienda.
- **Inventario:** la fuente de verdad es el kardex (`stock_movement`); `stock` es un snapshot. Costo promedio ponderado.
- **Contabilidad:** partida doble; los asientos deben cuadrar (débitos = créditos) antes de contabilizar.

## 7. Fase actual

**Fase 1 — Fundación.** Ver `/docs/backlog-fase1.md`.
Empezar por el **Sprint 1**: estructura del proyecto, Docker + CI/CD, migraciones desde `erp_schema.sql`, y auditoría.
No implementar módulos operativos (inventario, ventas, etc.) todavía.

## 8. Comandos (completar al crear el proyecto)

```bash
# Levantar entorno local
docker compose up

# Backend
cd apps/api && npm install && npm run start:dev

# Migraciones
npm run migration:run

# Pruebas
npm test
```

## 9. Convenciones de código

- TypeScript estricto. `camelCase` en código, `snake_case` en DB (mapear en el ORM).
- Un módulo NestJS por bounded context (auth, company, users-rbac, catalog, inventory, sales, crm, workshop, accounting, web/storefront, fiscal-gateway).
- Pruebas para la lógica clave; PR pequeño y revisado antes de merge.
- No exponer secretos ni llaves en el código; usar variables de entorno / gestor de secretos.

## 10. Definición de Terminado (DoD)

PR aprobado y mergeado · pruebas en verde en CI · cumple criterios de aceptación · valida permisos y aislamiento por empresa ·
desplegado en stage · documentación mínima actualizada.
