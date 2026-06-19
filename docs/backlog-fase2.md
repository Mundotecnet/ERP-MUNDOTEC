# Backlog Fase 2 — Módulos operativos

Continuación de la **Fase 1** (16 PRs cerrados + hotfix). En esta fase entran los módulos de negocio sobre la fundación: catálogo de productos, inventario, compras, ventas, POS/caja, CRM/taller, contabilidad, microservicio fiscal CR y tienda en línea.

> Reglas heredadas de `CLAUDE.md` (no negociables):
>
> - `db/erp_schema.sql` sigue siendo la **fuente de verdad** del modelo. Vistas, CHECK y triggers van como SQL crudo dentro de las migraciones (Prisma no los modela).
> - Multiempresa (`company_id` en TODA consulta), soft-delete con `deleted_at`, auditoría en `audit_log`, RBAC por endpoint.
> - El kardex (`stock_movement`) es la fuente de verdad del inventario; `stock` es solo snapshot. Costo promedio ponderado.
> - Contabilidad: partida doble, débitos == créditos antes de contabilizar.

## Orden de sprints

| Sprint | Módulo                                                                        | Estado    |
| ------ | ----------------------------------------------------------------------------- | --------- |
| **5**  | Productos / Items / Stock-snapshot (read-only)                                | en curso  |
| 6      | Inventario / Kardex (movimientos, ajustes, transferencias, valuación)         | pendiente |
| 7      | Compras (proveedores, OC, recepciones)                                        | pendiente |
| 8      | Ventas core (clientes, cotizaciones, órdenes, facturas — sin pagos ni fiscal) | pendiente |
| 9      | Caja / POS (sesiones, tickets, métodos de pago, cierre)                       | pendiente |
| 10     | CRM / Tickets / Taller (contactos, OTs)                                       | pendiente |
| 11     | Contabilidad (plan de cuentas, asientos automáticos)                          | pendiente |
| 12     | Microservicio Fiscal CR (FastAPI + XAdES-EPES + Hacienda)                     | pendiente |
| 13     | Tienda en línea (`web-store` + BFF público con WAF/rate-limit)                | pendiente |

El orden refleja dependencias: el catálogo de productos es prerrequisito de inventario, compras, ventas, POS y tienda. La contabilidad consume eventos de los módulos transaccionales. El fiscal sólo se activa cuando ventas y NCs están maduras. La tienda en línea cierra la fase porque depende de catálogo público, precios, stock y pedidos.

---

## Sprint 5 — Productos / Items / Stock-snapshot

**Objetivo**: dejar el catálogo de productos administrable desde el ERP y exponer el stock por almacén en modo lectura. Sin movimientos de inventario todavía.

### HU-7.1 — Productos (CRUD)

Tabla canónica `product` (líneas 194–217 de `erp_schema.sql`):

| Campo                      | Tipo                | Notas                                             |
| -------------------------- | ------------------- | ------------------------------------------------- |
| `sku`                      | VARCHAR(60)         | único por empresa (`UNIQUE(company_id, sku)`)     |
| `barcode`                  | VARCHAR(60)         | indexado, no único (puede repetir entre empresas) |
| `name`                     | VARCHAR(200)        | indexado                                          |
| `description`              | TEXT                | opcional                                          |
| `category_id`              | FK product_category | opcional                                          |
| `uom_id`                   | FK unit_of_measure  | requerido                                         |
| `tax_id`                   | FK tax              | opcional (default de la empresa)                  |
| `cost_price`, `sale_price` | NUMERIC(18,4)       | moneda base                                       |
| `price_currency`           | CHAR(3)             | default `'USD'`                                   |
| `is_inventoried`           | BOOLEAN             | `FALSE` = servicio                                |
| `tracking_type`            | VARCHAR(10)         | `NONE` \| `SERIAL` \| `LOT`                       |
| `warranty_months`          | INT                 | garantía estándar                                 |
| `min_stock`, `max_stock`   | NUMERIC(18,4)       | alertas                                           |
| `is_active`                | BOOLEAN             | toggle de catálogo                                |
| `deleted_at`               | TIMESTAMPTZ         | soft-delete                                       |

**Endpoints**: `GET /products`, `GET /products/:id`, `POST /products`, `PATCH /products/:id`, `DELETE /products/:id` (soft).
**Permisos**: `catalogs.product.read`, `catalogs.product.manage`.
**Reglas**:

- FK a `category_id`, `uom_id`, `tax_id` validadas contra la empresa del usuario (las globales no filtran por company).
- `tracking_type` restringido por enum runtime; `price_currency` debe ser un código de `currency` válido.
- `delete` se transforma en `update({ deletedAt })` por la extensión soft-delete.

### HU-7.2 — Stock-snapshot (read-only)

Tabla `stock` ya existe en `erp_schema.sql`. Sólo lectura por ahora.

**Endpoints**: `GET /stock?productId=&warehouseId=` con filtros opcionales.
**Permisos**: `inventory.stock.read`.
**Sin escrituras**: hasta Sprint 6 los registros vienen del seed/admin DB.

### HU-7.3 — Página `/productos` en web-erp

Primer CRUD real con formulario en la UI:

- Tabla con búsqueda por SKU/nombre.
- Formulario de alta/edición con selects para categoría/UoM/impuesto.
- Toggle de "activo" y "inventariado".

### Plan de PRs del Sprint 5

- **PR-18** ✓ backend HU-7.1 (modelo Product + migración + módulo NestJS + permisos + tests).
- **PR-19** ✓ backend HU-7.2 (stock snapshot read-only) + frontend HU-7.3 (página `/products` con CRUD y `/stock` con filtros).
