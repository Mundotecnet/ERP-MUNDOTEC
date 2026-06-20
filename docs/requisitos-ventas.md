# Requisitos de Cotizaciones y Ventas (ERP, no POS)

> Documento de **requisitos congelados** para los sprints de Cotizaciones y
> Ventas en la UI interna del ERP (no aplica al módulo POS móvil, que tendrá
> sus propios requisitos por la naturaleza de venta directa al consumidor).
> **No hay código implementado todavía** para ninguna de estas reglas —
> este archivo es la fuente de verdad mientras se planifican los sprints
> correspondientes.
>
> Cualquier cambio a estas reglas debe pactarse aquí **antes** de tocar
> `db/erp_schema.sql`, `apps/api/prisma/schema.prisma` o los módulos NestJS.
>
> Relacionado: [`requisitos-precios-cxc.md`](requisitos-precios-cxc.md) cubre
> las reglas de precios, márgenes y CxC multimoneda que también aplican a
> Ventas.

## Resumen

| #   | Tema                                               | Tablas clave (canónico)                                                     | Estado    |
| --- | -------------------------------------------------- | --------------------------------------------------------------------------- | --------- |
| 1   | Vista 360 del producto en la búsqueda de productos | `product`, `stock`, `price_list_item`, `invoice_line`, `goods_receipt_line` | Pendiente |

---

## 1. Vista 360 del producto en la búsqueda de productos

### Contexto

En las pantallas de **Cotizaciones** y **Ventas** (no POS), el usuario abre un
buscador de productos para añadir líneas al documento. Mientras navega los
resultados, el operador necesita ver de un vistazo toda la información
relevante del producto sin abandonar el flujo de venta: stock, precios,
costo, margen y el historial comercial. Esta "vista 360" reduce errores de
cotización (vender a un precio bajo, prometer stock que no hay, etc.) y
acelera la toma de decisión.

**Restricción explícita**: es **solo consultas + UI**. No requiere cambios
de esquema. Se apoya en tablas existentes: facturas/pedidos, órdenes de
compra, recepciones, stock y precios.

### Disparadores

El popup se abre con cualquiera de estos gestos sobre una fila de resultado
de la búsqueda de productos:

- **Clic derecho** sobre la fila → menú contextual con "Ver información del
  producto" como primera opción.
- **Icono "info"** (ⓘ) visible al final de la fila — siempre clickeable, no
  depende del menú contextual.
- **Teclado**: `Alt + I` con la fila enfocada (atajo opcional, no
  prioritario para la primera versión).

El popup es **no modal**: el usuario puede seguir interactuando con el
buscador y arrastrar o cerrar el popup independientemente. Si se cierra el
buscador, el popup también se cierra.

### Composición — cabecera

Siempre visible en la parte superior del popup:

| Campo                 | Fuente                                                        | Notas                                                    |
| --------------------- | ------------------------------------------------------------- | -------------------------------------------------------- |
| SKU                   | `product.sku`                                                 | En `font-mono`.                                          |
| Nombre                | `product.name`                                                |                                                          |
| Stock total           | `Σ stock.quantity` por `product_id`                           | Suma sobre todos los almacenes activos.                  |
| Stock por almacén     | `stock` agrupado por `warehouse_id`                           | Mini-tabla con `code`, `name`, `quantity`. Solo > 0.     |
| Precio 1 / 2 / 3      | `price_list_item.price` de las 3 primeras `price_list` (SALE) | Ver más abajo cómo se resuelven.                         |
| Costo                 | Costo promedio ponderado del kardex                           | `Σ(stock.quantity·stock.avg_cost) / Σ(stock.quantity)`.  |
| Margen                | Calculado: `(precio - costo) / precio` sobre **Precio 1**     | Ver `requisitos-precios-cxc.md#1` (margen sobre precio). |
| Moneda de cada precio | `price_list.currency_code`                                    | Mostrar el código junto al monto.                        |

**Cómo se resuelven "Precio 1/2/3"**:

- Por convención: las primeras tres `price_list` de la empresa con
  `list_type='SALE'` e `is_active = TRUE`, ordenadas por id.
- Si la empresa ya migró al esquema con categorías de cliente A–E (req 2 de
  precios-cxc), Precio 1/2/3 corresponden a las listas de las categorías
  A/B/C. La pantalla usa los nombres reales de las listas como header de
  columna ("Lista A", "Lista B", "Lista C") en vez del genérico
  "Precio 1/2/3".
- Si una lista no tiene `price_list_item` vigente para el producto, se
  muestra `—` (no se cae al `product.sale_price` para no engañar; ese
  fallback solo aplica al cotizar, ver req 2 de precios-cxc).

### Pestaña "Ventas"

Tabla y KPIs sobre el historial de facturación del producto.

**Tabla — Últimas ventas** (paginada, 20 por página):

| Columna         | Fuente                    | Notas                                                              |
| --------------- | ------------------------- | ------------------------------------------------------------------ |
| Fecha           | `invoice.invoice_date`    | Ordenada DESC.                                                     |
| Cliente         | `partner.legal_name`      | Tooltip con `partner.trade_name` y `tax_id` si existen.            |
| Cantidad        | `invoice_line.quantity`   |                                                                    |
| Precio unitario | `invoice_line.unit_price` | Con moneda del documento (`invoice.currency_code`).                |
| Vendedor        | `app_user.full_name`      | A través de `invoice.salesperson_id` o `created_by` como fallback. |
| Documento       | `invoice.invoice_number`  | Link al detalle de la factura.                                     |

**KPIs** (mostrados arriba de la tabla):

- **Última venta**: fecha + cliente + cantidad de la fila más reciente.
- **Precio promedio** del periodo seleccionado:
  `Σ(quantity·unit_price·exchange_rate) / Σ(quantity)` en moneda base.
- **Total vendido en el periodo**: `Σ(quantity)` y `Σ(line_total·exchange_rate)`
  en moneda base. Mostrar ambos.
- **Mejores clientes** (top 5): partners agrupados por
  `Σ(quantity·unit_price·exchange_rate)` en moneda base, con su porcentaje
  sobre el total del producto.

**Selector de periodo**: chips/pills con `1m / 3m / 6m / 12m / Personalizado`.
Default **12 meses**. La selección persiste en `localStorage` por usuario.

### Pestaña "Compras"

Análoga a Ventas pero sobre `goods_receipt` (autoritativo) o `invoice` de
proveedor cuando se modele factura de compra; mientras tanto **se usan las
recepciones** (`goods_receipt_line`).

**Tabla — Últimas compras** (paginada, 20 por página):

| Columna        | Fuente                                 | Notas                                                                                |
| -------------- | -------------------------------------- | ------------------------------------------------------------------------------------ |
| Fecha          | `goods_receipt.receipt_date`           | Ordenada DESC.                                                                       |
| Proveedor      | `partner.legal_name` (via OC.supplier) | Solo si la recepción tiene `purchase_order_id`; sin OC → "Manual".                   |
| Cantidad       | `goods_receipt_line.quantity`          |                                                                                      |
| Costo unitario | `goods_receipt_line.unit_cost`         | En moneda de la OC (cuando existe) o moneda base.                                    |
| Documento      | `goods_receipt.receipt_number`         | Link al detalle. Si hay OC, también mostrar `purchase_order.order_number` como chip. |

**KPIs**:

- **Último costo**: `unit_cost` de la fila más reciente + fecha y proveedor.
- **Proveedor habitual** (top 1): el partner con
  `Σ(quantity)` más alto en el periodo, con su porcentaje del total.
- (Opcional) **Costo promedio** del periodo:
  `Σ(quantity·unit_cost) / Σ(quantity)`.

**Selector de periodo**: mismo control que Ventas.

### Sección contextual — historial del cliente actual

Si la cotización o pre-factura activa **ya tiene un cliente seleccionado**,
el popup muestra una sección adicional (o pestaña "Cliente actual") con el
historial de **ese cliente específico** con **este producto**:

- Tabla similar a "Ventas" pero filtrada por `invoice.customer_id`:
  fecha, cantidad, precio unitario, documento.
- KPIs específicos del cliente con este producto:
  - Última compra del cliente con este producto: fecha, precio, cantidad.
  - Precio promedio histórico del cliente con este producto.
  - Cantidad total comprada por el cliente del producto en el periodo.
  - "Descuento promedio aplicado al cliente": comparar
    `unit_price` del cliente vs precio de lista vigente al momento de cada
    venta, expresado en %.

Si el usuario aún no eligió cliente en la cotización, esta sección **no se
muestra** (el tab queda oculto, no deshabilitado, para no contaminar la UI).

### Endpoints sugeridos (backend)

Para no rompler la UI con N queries Prisma, exponer un endpoint compuesto
que agrupe los datos necesarios:

- `GET /products/:id/overview?period=12m` — devuelve `{ summary, stockByWarehouse, prices, sales, purchases }` con los datos de cabecera, ventas y compras del periodo. Cada bloque trae sus KPIs ya calculados.
- `GET /products/:id/customer-history?customerId=&period=12m` — devuelve `{ summary, lines }` para la sección contextual de cliente.

Ambos endpoints son **read-only**, agnósticos al estado del documento que el
usuario está editando (no llega ni el id del documento al backend).

### Rendimiento y consideraciones

- Las queries de ventas y compras pueden ser pesadas en empresas con mucho
  histórico. Aplicar **siempre** filtro por periodo (default 12 meses) y
  paginar las tablas con `LIMIT 20` server-side.
- Los KPIs se calculan en SQL con `Σ` sobre el conjunto filtrado, no en
  memoria.
- El popup hace **una sola request al abrir** (no por pestaña). El usuario
  puede recargar manualmente con un botón si quiere ver datos más frescos.
- Caché ligera del lado del cliente (`react-query` con `staleTime: 60s`):
  cambiar de producto en la búsqueda no debe re-fetchear si vuelve al
  anterior dentro de un minuto.
- La sección "Cliente actual" se trae solo cuando el popup detecta cliente
  en contexto y el usuario abre esa pestaña — no se trae en la request
  inicial.

### Permisos sugeridos

- `sales.product-360.read` — abrir la vista 360 desde cotizaciones/ventas.
  Lo trae implícito cualquier rol que ya tenga `sales.quote.read` o
  `sales.invoice.read`. Decisión de implementación: **no crear permiso
  nuevo**; reutilizar el del módulo de ventas correspondiente.
- El detalle de costos y márgenes puede ser sensible: si el rol no tiene
  `pricing.read` (ver `requisitos-precios-cxc.md` anexo), **ocultar** las
  columnas de costo y margen pero mostrar el resto (stock, precios, ventas,
  compras).

### Por qué no requiere cambios de esquema

Las tablas necesarias ya están en `db/erp_schema.sql` o llegarán por
sprints anteriores ya planificados:

- `product` ✓ (PR-18).
- `stock` ✓ (PR-19).
- `price_list`, `price_list_item` — canónico, se modelan en el sprint de
  Precios futuro.
- `invoice`, `invoice_line` — canónico, se modelan en el sprint de Ventas
  (HU-10.x).
- `goods_receipt`, `goods_receipt_line` ✓ (PR-25).
- `purchase_order`, `purchase_order_line` ✓ (PR-24).
- `partner` ✓ (PR-23).
- `app_user` ✓ (PR-9).

Si en algún sprint posterior se decide guardar también el **costo histórico
al momento de la venta** en `invoice_line` (no está en el canónico actual),
el cálculo del margen histórico por línea de venta dejará de depender de
`stock.avg_cost`. Esa decisión, si se toma, va en este archivo antes de
modificar el SQL.
