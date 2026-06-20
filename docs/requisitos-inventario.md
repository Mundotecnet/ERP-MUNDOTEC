# Requisitos de Inventario (operación y mantenimiento)

> Documento de **requisitos congelados** para los sprints futuros del módulo
> de Inventario más allá del kardex base (Sprint 6) y el snapshot de stock
> (Sprint 5). **No hay código implementado todavía** para ninguna de estas
> reglas — este archivo es la fuente de verdad mientras se planifican los
> sprints correspondientes.
>
> Cualquier cambio a estas reglas debe pactarse aquí **antes** de tocar
> `db/erp_schema.sql`, `apps/api/prisma/schema.prisma` o los módulos NestJS.
>
> Relacionado:
>
> - [`requisitos-precios-cxc.md`](requisitos-precios-cxc.md) — fórmulas de
>   costo/margen y el utilitario de precios.
> - [`requisitos-ventas.md`](requisitos-ventas.md) — vista 360 del producto.

## Resumen

| #   | Tema                                  | Tablas clave (canónico)                                               | Estado    |
| --- | ------------------------------------- | --------------------------------------------------------------------- | --------- |
| 1   | Módulo de mantenimiento de inventario | `inventory_adjustment`, `inventory_adjustment_line`, `stock_movement` | Pendiente |

---

## 1. Módulo de mantenimiento de inventario

### Contexto

Pantalla **operativa única** para que el equipo de bodega ejecute conteos
físicos y correcciones de existencias sin saltar entre formularios. El
objetivo es minimizar el tiempo entre _"abrir Excel del conteo"_ y _"guardar
ajuste"_, manteniendo la trazabilidad contable (cada diferencia se materializa
como un movimiento de kardex `ADJUST` con motivo).

**Restricción explícita**: **no requiere cambios al canónico**. Las tablas
ya están en `db/erp_schema.sql`:

- `inventory_adjustment` (líneas 1382–1399 del canónico) con `status` DRAFT
  / CONFIRMED / CANCELLED, `reason`, filtros materializados
  (`filter_department_id`, `filter_supplier_id`, `filter_sold_only`),
  `confirmed_by`/`confirmed_at`.
- `inventory_adjustment_line` (1402–1411) con `system_qty`, `counted_qty`,
  `diff_qty`, `unit_cost`, `note`.
- `stock_movement` (modelo del PR-20) para los efectos sobre el kardex.

### Disparadores / acceso

- Entrada del menú **Inventario → Mantenimiento** (gateada por
  `inventory.adjustment.read`).
- Acceso directo desde la **vista 360 del producto** (ver
  `requisitos-ventas.md`) con un botón "Ajustar inventario" cuando el rol
  tiene `inventory.adjustment.manage`.

La pantalla soporta dos modos:

1. **Nuevo ajuste**: pantalla en blanco, el usuario aplica filtros y carga el
   grid con los productos resultantes.
2. **Ajuste existente en DRAFT**: lista de borradores arriba; al abrir uno,
   se restauran los filtros materializados del header
   (`filter_department_id`, `filter_supplier_id`, `filter_sold_only`) y se
   muestra el grid con las líneas ya capturadas.

### Pantalla — una sola vista

Todo en una pantalla, sin wizard ni navegación por pasos:

```
┌────────────────────────────────────────────────────────────────────────┐
│  Filtros                                                       [↻]    │
│  ┌────────┐ ┌────────┐ ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌──────┐  │
│  │Período │ │Almacén │ │Departam.│ │Proveedor │ │Categoría│ │ ☐sold│  │
│  └────────┘ └────────┘ └─────────┘ └──────────┘ └─────────┘ └──────┘  │
│  ☐ "Más vendidos"  ☐ "Más comprados"  🔎 Búsqueda (SKU/nombre)         │
│  [ Cargar productos ]    312 productos · valor ajuste neto: ₡15.420,50│
├────────────────────────────────────────────────────────────────────────┤
│ Grid editable: SKU | Producto | Almacén | Stock | Físico | Δ | $ | $Δ │
│ ▌P-001  ...                                                            │
│ ...                                                                    │
├────────────────────────────────────────────────────────────────────────┤
│  Motivo: [Conteo físico ▾]   Notas: [_________]                       │
│  ☐ Conteo a ciegas    [Guardar DRAFT]  [Confirmar ajuste]             │
└────────────────────────────────────────────────────────────────────────┘
```

### Filtros — sección superior

Todos combinables (AND lógico). Cada filtro corresponde a un campo del
canónico o a una consulta sobre tablas existentes.

| Filtro             | Tipo                 | Fuente / cómo se aplica                                                                                                             |
| ------------------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Rango de fechas    | `from`–`to`          | Define la ventana para "más vendidos/comprados" y para los KPI de valor del ajuste vs. valor vendido. Default: últimos 90 días.     |
| "Más vendidos"     | toggle               | Filtra a productos con al menos 1 `invoice_line` en el rango; ordena el grid por `Σ quantity` DESC.                                 |
| "Más comprados"    | toggle               | Filtra a productos con al menos 1 `goods_receipt_line` en el rango; ordena por `Σ quantity` DESC.                                   |
| Departamento       | select               | `product.department_id`. Se materializa en `inventory_adjustment.filter_department_id` al guardar.                                  |
| Proveedor habitual | select (partners)    | Se cruza con `product.default_supplier_id`. Se materializa en `inventory_adjustment.filter_supplier_id`.                            |
| Categoría          | select jerárquico    | `product.category_id` con expansión a hijas (la jerarquía ya existe desde PR-14).                                                   |
| Almacén            | select **requerido** | `inventory_adjustment.warehouse_id`. El ajuste **siempre** es por almacén; un multi-almacén se hace con varios ajustes encadenados. |
| Búsqueda libre     | input                | `ILIKE %query%` sobre `product.sku`, `product.barcode`, `product.name`. No materializado en el header (solo afecta el grid).        |

Si el toggle "Más vendidos" se combina con `filter_sold_only=TRUE`, en el
header del ajuste se guarda esa bandera para que un usuario que reabra el
borrador entienda el alcance original. Los demás filtros no materializados
(rango de fechas, búsqueda libre) **no** se persisten — son ayudas de
captura.

### Grid editable

Columnas (todas mostradas; el usuario puede ocultar las que no necesite vía
un menú de columnas):

| Columna            | Origen                                  | Editable | Notas                                                                                             |
| ------------------ | --------------------------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| SKU                | `product.sku`                           | no       | Sticky a la izquierda. `font-mono`.                                                               |
| Producto           | `product.name`                          | no       | Con tooltip de descripción.                                                                       |
| Almacén            | `warehouse.code`                        | no       | Mismo para todas las líneas (el header lo fija).                                                  |
| Stock (`system`)   | `stock.quantity` al instante de carga   | no       | Se congela al cargar. Si cambia en otra sesión, conflicto al confirmar.                           |
| Físico (`counted`) | `inventory_adjustment_line.counted_qty` | **sí**   | Input numérico, 4 decimales.                                                                      |
| Δ (`diff`)         | calculado: `counted - system`           | no       | Verde si > 0, rojo si < 0, gris si = 0. Se persiste en `diff_qty` al guardar.                     |
| Costo              | `stock.avg_cost` al instante de carga   | no       | También se congela; se persiste en `unit_cost` para que la valuación del ajuste sea reproducible. |
| Valor ajuste       | calculado: `diff × costo`               | no       | Suma al footer.                                                                                   |
| Nota               | `inventory_adjustment_line.note`        | **sí**   | Texto corto (≤ 200 chars). Visible al expandir la fila.                                           |

**Líneas sin diferencia (`diff = 0`)**: por defecto **se filtran** del grid
al cargar para que el operador vea solo lo que toca capturar. Un toggle
"Mostrar todas las líneas" devuelve la vista completa. Al guardar, las
líneas con `diff = 0` **no generan movimiento de kardex**; se persisten en
`inventory_adjustment_line` con `diff_qty=0` solo si el operador
explícitamente las dejó marcadas (modo "conteo completo"). Por defecto se
omiten para no inflar la tabla.

**Footer agregado** (sticky):

- `Σ líneas con diff ≠ 0`
- `Σ valor del ajuste` (puede ser positivo o negativo, en moneda base)
- `Σ valor del ajuste positivo` y `Σ negativo` por separado.

### Edición en línea — navegación por teclado

Comportamiento estilo Excel:

- `Enter` o `↓` mueve la celda activa a la **siguiente fila** en la misma
  columna (Físico).
- `Tab` mueve a la celda siguiente en la fila (Físico → Nota).
- `Shift+Tab` / `↑` para el inverso.
- `Esc` revierte la edición de la celda actual.
- `Ctrl+S` guarda el borrador (no confirma).
- `Ctrl+Enter` abre el modal de confirmación (no confirma directo).

**Validación inline**: si el operador captura un valor que no sea decimal
positivo con hasta 4 decimales, la celda se marca con borde rojo y `Enter`
no avanza hasta que se corrija.

### Modos avanzados (opcionales para la primera versión)

- **Escaneo**: la pantalla tiene un input "Escanear" que recibe lecturas de
  un lector de códigos de barras. Al escanear:
  1. Si el código corresponde a un `product.barcode` de una fila visible →
     incrementa `counted_qty` de esa fila en `+1` (o por la cantidad
     configurada como "step de escaneo"), enfoca la celda y la resalta.
  2. Si el producto no está en el grid pero pasa los filtros activos, se
     **inserta** en el grid con `system_qty` actual y `counted_qty = 1`.
  3. Si el barcode no existe o el producto no aplica a los filtros → toast
     de error sin tocar el grid.
- **Conteo a ciegas**: cuando el toggle está activo, la columna `Stock`
  (`system_qty`) **se oculta** durante la captura, junto con `Δ`, `Costo`
  y `Valor ajuste`. El operador solo ve SKU, Producto y Físico. La idea es
  forzar un conteo honesto sin que el sistema sugiera el número. Al
  guardar como DRAFT o confirmar, las columnas se hacen visibles
  nuevamente con los cálculos.

### Workflow de guardado — DRAFT → CONFIRMED

**`Guardar DRAFT`**:

- Crea (o actualiza si ya estaba en DRAFT) el `inventory_adjustment` con
  los filtros materializados, `reason`, `warehouse_id`, `adjustment_number`
  (generado server-side con el correlativo de la empresa), `created_by`.
- Hace `replace-all` del set de `inventory_adjustment_line` con los valores
  capturados (mismo patrón usado en PR-24 para líneas de OC).
- `status` queda en `DRAFT`. **No** genera movimientos de kardex.
- Cualquier usuario con `inventory.adjustment.manage` puede reabrir el
  DRAFT y seguir editando; el borrador no es "propiedad" del creador.

**`Confirmar ajuste`** (con permiso adicional
`inventory.adjustment.confirm` para hacer la separación de funciones —
quien cuenta vs. quien confirma):

- Pre-validación: refresca `system_qty` y `unit_cost` de cada línea contra
  el stock actual. Si hay diferencias respecto a lo congelado al cargar el
  grid (otro proceso movió stock), muestra un dialog de conflictos con tres
  acciones: **Reanudar conteo** (re-cargar el grid con los nuevos
  `system_qty`), **Mantener mis valores** (sigue con los congelados, marca
  el ajuste con `reason` extendido), o **Cancelar**.
- Si todo OK, ejecuta en una **única transacción Prisma**:

  1. `UPDATE inventory_adjustment SET status='CONFIRMED', confirmed_by =
user.id, confirmed_at = now() WHERE id = …`.
  2. Para cada `inventory_adjustment_line` con `diff_qty ≠ 0`:
     `StockMovementsService.applyMovementInTx` con:
     - `movementType = 'ADJUST'`
     - `quantity = diff_qty` (signed: + = sobrante, − = faltante)
     - `unitCost = inventory_adjustment_line.unit_cost`
     - `sourceDoc = 'ADJUSTMENT'`
     - `sourceId = inventory_adjustment.id`
     - `notes = reason` (concatenado con la nota de la línea si existe)
  3. La actualización de `stock.quantity` y `stock.avg_cost` la hace el
     propio `applyMovementInTx` (regla del kardex del PR-20).

- Una vez `CONFIRMED`, **el ajuste es inmutable**. Para corregir un error
  detectado después, se genera **otro ajuste compensatorio** (mismo patrón
  que el kardex: append-only).

**`Cancelar`** (solo válido en `DRAFT` o `CONFIRMED` recién creado dentro de
una ventana de tolerancia configurable, p. ej. mismo día — decisión
pendiente con el negocio):

- En `DRAFT`: cambia `status` a `CANCELLED`, no toca kardex.
- En `CONFIRMED` (si se permite revertir): genera el ajuste compensatorio
  automáticamente con los `diff_qty` invertidos. La operación queda
  registrada en `audit_log` con el `user_id` que canceló.

### Reglas de valuación

- `unit_cost` capturado en cada línea es el **`avg_cost` vigente al instante
  de carga del grid**. Eso garantiza que el valor del ajuste sea
  reproducible aún si después de la confirmación entran movimientos nuevos
  que cambien el `avg_cost`.
- El kardex aplica la regla normal del CPP (ver
  `apps/api/src/stock-movements/stock-movements.service.ts`): un
  `ADJUST` positivo recalcula el `avg_cost` (usa el `unit_cost` del
  ajuste), un `ADJUST` negativo mantiene el `avg_cost` actual.
- Si en el futuro se introduce un asiento contable automático al confirmar
  un ajuste, la cuenta de contrapartida (mermas, sobrantes, regularización)
  se toma de `company_param` con las claves
  `accounting.inventory_shortage_account_id` y
  `accounting.inventory_overage_account_id`. Esa decisión se documenta
  aquí cuando entre el módulo de Contabilidad.

### Endpoints sugeridos (backend)

- `GET /inventory-adjustments?status=&warehouseId=&from=&to=` — listado.
- `GET /inventory-adjustments/:id` — header + líneas (incluyendo `diff_qty`
  y valor).
- `POST /inventory-adjustments` — crea borrador desde los filtros del
  formulario. Body: `{ warehouseId, reason, filter_department_id?,
filter_supplier_id?, filter_sold_only?, lines: [{ productId, countedQty,
note? }] }`. Server **calcula** `system_qty`, `unit_cost`, `diff_qty` para
  cada línea — el cliente no decide esos números.
- `PATCH /inventory-adjustments/:id` — actualiza un DRAFT (replace-all de
  líneas).
- `POST /inventory-adjustments/:id/confirm` — transición + generación de
  kardex en una sola tx.
- `POST /inventory-adjustments/:id/cancel` — DRAFT → CANCELLED (o
  CONFIRMED → CANCELLED con compensación si se acepta la regla).
- `GET /inventory-adjustments/search-products?...` — endpoint compuesto que
  recibe los filtros (incluido toggle "más vendidos") y devuelve el set de
  productos a poblar el grid con sus `system_qty`, `avg_cost` y, opcional,
  `last_count_date`. Server-side `LIMIT 500` para no quemar el navegador;
  si la query trae más, devuelve un aviso y obliga a refinar.

### Permisos sugeridos

| Código                         | Descripción                                             |
| ------------------------------ | ------------------------------------------------------- |
| `inventory.adjustment.read`    | Ver listado y detalle de ajustes.                       |
| `inventory.adjustment.manage`  | Crear/editar/eliminar borradores; capturar líneas.      |
| `inventory.adjustment.confirm` | Confirmar un DRAFT y generar los movimientos de kardex. |
| `inventory.adjustment.cancel`  | Cancelar (con o sin compensación según la regla final). |

La separación entre `manage` y `confirm` permite que el operador de bodega
capture, pero un supervisor sea quien valide y aplique. Si la empresa no
quiere esa separación, asignar ambos al mismo rol — el modelo lo permite.

### Performance y consideraciones

- El `GET /inventory-adjustments/search-products` puede tocar mucho stock.
  Indexar oportunamente y evaluar materializar una vista por almacén si la
  pantalla se vuelve lenta con catálogos grandes.
- El grid en el navegador debe usar **virtualización de filas** (p. ej.
  `@tanstack/react-virtual`) para soportar 500+ líneas sin lag.
- El estado del grid se autoguarda en `localStorage` cada N segundos
  mientras está en DRAFT; al recargar la página el operador no pierde su
  captura local antes del primer "Guardar DRAFT".
- El cálculo de `diff` y `valor ajuste` es 100% client-side mientras se
  edita — el server solo recalcula al guardar/confirmar para evitar
  divergencia.

### Por qué no requiere cambios de esquema

- `inventory_adjustment` y `inventory_adjustment_line` ya están en el
  canónico (líneas 1382–1412) con todos los campos que la pantalla necesita.
- `stock_movement` con tipo `ADJUST` ya está implementado (PR-20).
- `StockMovementsService.applyMovementInTx` ya es público (PR-25) y maneja
  el CPP correctamente para ADJUST.
- Los permisos nuevos se agregan al `seed.ts` cuando se implemente el
  módulo — no afectan al canónico.

Si en algún sprint posterior aparece la necesidad de un **conteo cíclico
programado** (jobs que pre-arman ajustes mensualmente por categoría), eso sí
requiere una nueva tabla `inventory_count_plan` y se discute aquí antes de
implementar.
