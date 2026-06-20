# Requisitos de Precios, Ventas y CxC

> Documento de **requisitos congelados** para los sprints futuros de Precios,
> Ventas y la integración con Compras. **No hay código implementado todavía**
> para ninguna de estas reglas — este archivo es la fuente de verdad mientras
> se planifican los sprints correspondientes.
>
> Cualquier cambio a estas reglas debe pactarse aquí **antes** de tocar
> `db/erp_schema.sql`, `apps/api/prisma/schema.prisma` o módulos NestJS.

## Resumen

| #   | Tema                                                  | Tablas clave (canónico)                                    | Estado    |
| --- | ----------------------------------------------------- | ---------------------------------------------------------- | --------- |
| 1   | Tabla de precios por producto (costo, margen, precio) | `product`, `price_list_item` (`+ margin_pct`)              | Pendiente |
| 2   | Niveles de precio por categoría de cliente (A–E)      | `customer_category`, `price_list`, `price_list_item`       | Pendiente |
| 3   | Recálculo de precios al recibir una compra            | `goods_receipt_line`, `product_price_history`, `product`   | Pendiente |
| 4   | CxC multimoneda con diferencia cambiaria              | `invoice`, `payment`, `journal_entry` (cuentas FX)         | Pendiente |
| 5   | Utilitario de precios (operativo)                     | `price_list_item`, `product_price_history` + permiso nuevo | Pendiente |

---

## 1. Tabla de precios por producto

### Concepto

Cada producto exhibe simultáneamente tres números visibles en la UI: **costo**,
**margen**, **precio**. El margen es **sobre el precio de venta**, no sobre el
costo. Cambiar uno cualquiera de los tres recalcula el otro derivado.

### Fórmulas

Sea `cost` el costo promedio del producto, `margin` el margen como fracción
(0.30 = 30 %), y `price` el precio de venta:

```
margin = (price - cost) / price
price  = cost / (1 - margin)
cost   = price * (1 - margin)
```

Con `cost = 100` y `margin = 0.30`, se obtiene `price = 100 / (1 - 0.30) = 142.8571`.

### Fuente del costo

El **costo de referencia** para estas fórmulas es el **costo promedio
ponderado** del producto. La fuente operativa son las columnas `avg_cost` por
almacén en `stock`, agregadas por producto. Para una primera versión el ERP
puede usar `Σ(quantity·avg_cost) / Σ(quantity)` sobre todos los almacenes
inventariados del producto; el detalle por almacén se mantiene en kardex.

Cuando un producto no tiene existencias todavía (kardex vacío) y se quiere fijar
precio, se acepta `cost = product.cost_price` (campo declarativo del catálogo).
Esa caída se documenta en la UI.

### Convenciones de UI

- **Precio editable**: el usuario edita `price`; el sistema recalcula `margin`.
- **Margen editable**: el usuario edita `margin`; el sistema recalcula `price`.
- Cambiar `cost` desde aquí **no** está permitido — el costo viene del kardex.
  La pantalla muestra el costo como información, no como input.
- Mostrar `cost`, `margin %` y `price` en la moneda de la lista
  correspondiente; si la lista es en moneda distinta de la base, mostrar
  también el equivalente al tipo de cambio vigente.

### Implicaciones en el modelo

- `price_list_item` debe almacenar **al menos** el precio. El margen se
  guarda **explícitamente** como una columna `margin_pct NUMERIC(7,4)` para
  preservar la intención del usuario sin recalcularla.
- El costo en cada precio aplicado debe quedar capturado en
  `product_price_history.old_value`/`new_value` con `change_type='SALE'` para
  que el utilitario de precios (req 5) pueda rastrear quién cambió qué y por
  qué.

---

## 2. Niveles de precio ligados a categoría de cliente (A–E)

### Concepto

Cada empresa define hasta 5 categorías de cliente (`customer_category.code` ∈
{`A`,`B`,`C`,`D`,`E`}). Cada categoría tiene asociado un **nivel de precio**
mediante una `price_list` con `list_type='SALE'`. El cliente
(`partner.customer_category_id`) hereda automáticamente el precio que le
corresponde al cotizar/facturar.

### Modelo

Reusar el modelo canónico (`price_list` + `price_list_item`) y **agregar una
columna**:

```sql
ALTER TABLE price_list_item
    ADD COLUMN margin_pct NUMERIC(7,4) NOT NULL DEFAULT 0;
```

El campo `margin_pct` guarda la **intención** del margen al momento de fijar
el precio, no se autorecalcula. Un recálculo automático actualizará `price`
**y** `margin_pct` simultáneamente.

### Reglas

- Las 5 categorías (A–E) se preseedean por empresa (idempotente, ya hay
  módulo `CustomerCategoriesModule`).
- Una `price_list` se vincula a una `customer_category` por convención del
  campo `name` (p. ej. "Lista A", "Lista B"); o bien se agrega una columna
  `customer_category_id NULL` a `price_list` si se quiere relación dura.
  **Decisión por defecto**: agregar la columna para resolución determinista.
- Si un cliente no tiene categoría asignada, aplica la **lista por defecto
  de venta** (parámetro de empresa).
- Una `price_list_item` con `valid_from` / `valid_to` permite programar
  cambios de precio futuros — el endpoint de cotización resuelve el item
  vigente a la fecha del documento.

### Precedencia al cotizar

```
1. price_list de la categoría del cliente, item vigente a fecha del doc.
2. price_list por defecto de la empresa, item vigente.
3. product.sale_price (fallback declarativo del catálogo).
```

El cliente ve el origen del precio en la UI ("Lista A vigente desde …").

---

## 3. Recálculo de precios al ingresar una compra

### Disparador

Cuando se confirma una **recepción** (`goods_receipt`) sobre una OC
(`purchase_order`), el sistema recalcula:

1. Para cada producto: nuevo **costo promedio ponderado** (regla del kardex —
   ver `apps/api/src/stock-movements/`). Esto **siempre** ocurre.
2. Para cada producto: precio sugerido en cada `price_list` afectada,
   manteniendo el `margin_pct` declarado:

   ```
   new_price = new_cost / (1 - margin_pct)
   ```

### Flujo de confirmación

- El servicio de recepciones **no aplica** automáticamente el nuevo precio.
- Devuelve un **payload de preview** con tres listas: precios que **suben**,
  precios que **bajan**, y precios sin cambio. Cada renglón trae
  `productId`, `priceListId`, `oldPrice`, `newPrice`, `oldMargin`,
  `newMargin`, `category`, y bandera `out_of_margin` (ver más abajo).
- La UI **debe** mostrar la preview agrupada por dirección (alza/baja) y pedir
  confirmación explícita. Sin confirmación, no se persiste cambio de precio
  (el cambio de costo sí se persiste — es la regla del kardex).
- Al confirmar:
  - Se actualiza `price_list_item.price` y se inserta un registro en
    `product_price_history` con `change_type='SALE'`, `source='PURCHASE'`,
    `source_id = goods_receipt.id`, `changed_by = user.id`.
  - Para los productos cuyo costo cambió, se inserta otro registro con
    `change_type='COST'`, `source='PURCHASE'`. Este se **inserta siempre**
    aunque el usuario no confirme el cambio de precio.

### Bandera "fuera de margen"

Por categoría/lista se define un **margen mínimo aceptable**
(`margin_floor_pct`, parámetro de empresa por lista). Si tras el recálculo el
`margin_pct` efectivo cae por debajo del piso, se marca la línea con
`out_of_margin = true` en la preview y en `price_list_item.out_of_margin`.

- El item con `out_of_margin = true` sigue siendo facturable, pero la pantalla
  de ventas debe mostrar una alerta y, idealmente, requerir un permiso
  adicional (p. ej. `sales.override-out-of-margin`) para cotizar/facturar.
- El utilitario de precios (req 5) puede filtrar y recalcular masivamente
  productos `out_of_margin` para corregir el desbalance.

### Casos especiales

- **Compras en moneda extranjera**: el nuevo costo se convierte a moneda
  base con el `exchange_rate` de la `purchase_order`/`goods_receipt`. El
  precio recalculado se expresa en la moneda de cada `price_list` afectada;
  para listas en moneda extranjera se aplica el tipo de cambio vigente al
  momento de la confirmación (queda registrado en el historial).
- **Sin margen declarado**: si `price_list_item.margin_pct = 0`, el precio
  **no se recalcula automáticamente**. Aparece en la preview como informativo.
- **Productos con varias unidades de empaque**: el recálculo opera sobre el
  costo unitario del kardex; si la lista usa precio por bulto, se respeta la
  relación de empaque declarada en el catálogo.

---

## 4. CxC multimoneda por cliente

### Saldos separados por moneda

El saldo CxC de un cliente **no se consolida** sumando dólares y colones a un
único monto: el ERP mantiene saldos por moneda. Por defecto soportamos `CRC`
y `USD`, pero el modelo debe permitir cualquier `currency_code` que aparezca
en facturas emitidas.

Estructura conceptual:

```
customer_balance(partner_id, currency_code) = Σ invoice.balance_due en esa moneda
```

Las facturas guardan moneda (`invoice.currency_code`) y tipo de cambio
(`invoice.exchange_rate`) al momento de emisión; los pagos hacen lo mismo
(`payment.currency_code`, `payment.exchange_rate`).

### Diferencia cambiaria — REALIZADA

Cuando un pago liquida (parcial o totalmente) una factura **en una moneda
distinta** de la moneda de la factura, surge una **diferencia cambiaria
realizada**.

Definición operacional:

```
fx_diff_realizada = pago_en_moneda_base
                  - (porcion_aplicada_a_la_factura
                     * invoice.exchange_rate / payment.exchange_rate
                     * payment.exchange_rate)
```

En forma directa, comparando el monto de la factura aplicado en moneda base al
tipo de cambio de la factura vs. al tipo de cambio del pago:

```
fx_diff = portion_factura_moneda_doc * (payment.exchange_rate - invoice.exchange_rate)
```

Si `payment.exchange_rate > invoice.exchange_rate` y la factura está en
moneda extranjera, hay **ganancia cambiaria** (el cliente paga con un dólar
más caro); en caso contrario, **pérdida cambiaria**.

#### Asiento contable del pago

```
DR  Banco / Caja               (monto del pago en moneda base)
DR  Pérdida cambiaria CR / DR  (si fx_diff < 0)
CR  Cuentas por cobrar          (porcion_factura * invoice.exchange_rate)
CR  Ganancia cambiaria CR / CR  (si fx_diff > 0)
```

Las cuentas `Ganancia cambiaria` y `Pérdida cambiaria` son **parámetros
contables de la empresa** (`company_param` con keys
`accounting.fx_gain_account_id` y `accounting.fx_loss_account_id`). Deben
existir y estar configuradas antes de poder registrar pagos en moneda distinta.

### Diferencia cambiaria — NO REALIZADA (cierre)

Al cerrar un periodo (mes/año), las facturas **abiertas en moneda
extranjera** se re-valúan al tipo de cambio de cierre. La diferencia entre el
valor en moneda base al tipo de la factura y al tipo del cierre es la
**diferencia cambiaria no realizada**:

```
fx_diff_no_realizada = balance_due_moneda_doc
                     * (exchange_rate_cierre - invoice.exchange_rate)
```

Esta diferencia genera un **asiento de ajuste por valuación** sobre una
cuenta puente (`fx_unrealized_account_id`, parámetro). El asiento se **revierte
al inicio del siguiente periodo** para no contaminar la realización futura
cuando el cliente efectivamente pague.

### Reglas

- Toda factura, nota de crédito, nota de débito y pago **guardan
  `currency_code` y `exchange_rate`** al momento de emisión.
- Los saldos por moneda son la fuente de verdad; los reportes por
  cobrar muestran **una columna por moneda** con su equivalente en moneda
  base al tipo de cambio vigente del reporte.
- El crédito del cliente (`partner.credit_limit`) **es por moneda**. Decisión
  pendiente: ¿un solo `credit_limit` se interpreta en moneda base y se
  comparan los saldos convertidos, o se permite definir límites por moneda?
  Para Sprint 8 se asume **moneda base**; refinar después si el negocio lo
  pide.
- El cierre de periodo lo dispara un endpoint dedicado en el módulo de
  contabilidad; el ajuste de FX no realizada se genera como parte del
  proceso de cierre, idempotente.

---

## 5. Utilitario de precios (pantalla operativa)

Pantalla dedicada en `web-erp` para **operación masiva** sobre precios, no
para CRUD producto-a-producto.

### Filtros

Combinables (AND):

- **Departamento** (`product.department_id`)
- **Proveedor por defecto** (`product.default_supplier_id`)
- **Categoría de producto** (`product.category_id`)
- **Categoría de cliente** = qué `price_list` se está afectando
- **Vendidos en últimos N días** (consulta sobre `invoice_line`)
- **Margen actual** (rango: `< x %`, `entre x % y y %`, `> y %`)
- **Stock** (rango sobre `Σ stock.quantity` por almacén)
- **Moneda** de la lista (`price_list.currency_code`)
- **Estado**: `out_of_margin = true` solamente, etc.

El resultado del filtrado es una **selección** que el usuario puede ampliar o
recortar manualmente antes de aplicar acción.

### Acciones masivas

Sobre la selección filtrada:

- **Recalcular por margen objetivo**: `new_price = cost / (1 - margin)`.
- **Aumento/descuento porcentual**: `new_price = old_price × (1 + pct)`.
- **Aumento/descuento de monto fijo**: `new_price = old_price + amount` (en
  la moneda de cada lista).
- **Redondeo**: a múltiplos configurables (.00, .50, .99, etc.), con
  modos `floor` / `nearest` / `ceil`.
- **Cambio de moneda por tipo de cambio**: re-expresar la lista en otra
  moneda a una tasa indicada.

### Vista previa obligatoria

La acción **siempre** muestra un preview con tres tablas: items que **suben**,
items que **bajan**, items **sin cambio**. Por cada renglón:

```
sku · nombre · lista · old_price · new_price · Δ% · old_margin · new_margin · out_of_margin
```

El usuario puede **deseleccionar renglones específicos** desde el preview
antes de confirmar. **Nada se persiste sin confirmación explícita.**

### Aplicar — historial y permiso

- Al confirmar, los cambios se aplican en una transacción Prisma.
- Para cada `price_list_item` afectado:
  - `UPDATE price_list_item SET price = new_price, margin_pct = new_margin, out_of_margin = computed`.
  - `INSERT INTO product_price_history` con `change_type='SALE'`,
    `source='MANUAL'`, `source_id = batch_id` (id del lote, ver abajo),
    `changed_by = user.id`.
- Permiso requerido: `pricing.bulk-apply` (nuevo). Sin este permiso el botón
  "Aplicar" no se muestra; el preview sí (es informativo).
- Se registra un **lote** (`price_bulk_op`, tabla nueva) con
  `id`, `companyId`, `executedBy`, `executedAt`, `description`, `filterJson`,
  `actionJson`. El historial individual referencia este `batch_id` para que el
  rollback (siguiente bullet) sea atómico por operación.

### Opcionales (no requeridos para la primera versión, plan deseable)

- **Vigencia**: que la acción no se aplique de inmediato sino a partir de una
  fecha. Implementa como `price_list_item` con `valid_from` futuro mientras el
  vigente sigue activo; la resolución de precio por fecha (ver req 2) lo
  respetará automáticamente.
- **Rollback por lote**: revertir todos los cambios de un `batch_id`
  recuperando `old_value` desde `product_price_history`. Mismo permiso
  `pricing.bulk-apply` (o uno separado `pricing.rollback` si se quiere segregar).

---

## Anexo — Permisos nuevos sugeridos

Para no inventar nombres a mitad del sprint, fijar desde ahora la nomenclatura
de los permisos que estos requisitos implican:

| Código                            | Descripción                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `pricing.read`                    | Ver listas de precios y márgenes (read-only de la pantalla operativa).                                                         |
| `pricing.item.manage`             | Editar producto-a-producto el precio/margen de un item de lista.                                                               |
| `pricing.bulk-apply`              | Ejecutar acciones masivas y persistir cambios desde el utilitario.                                                             |
| `pricing.rollback`                | Revertir un lote completo desde el historial.                                                                                  |
| `pricing.confirm-purchase-recalc` | Confirmar el recálculo de precios al recibir una compra (puede separarse de `purchases.receipt.manage` si se quiere segregar). |
| `sales.override-out-of-margin`    | Facturar productos marcados `out_of_margin`.                                                                                   |
| `accounting.period-close`         | Disparar el cierre de periodo (que dispara el ajuste FX no realizada).                                                         |

Los permisos finales se versionan en `apps/api/prisma/seed.ts` cuando cada
sprint los implemente.

## Anexo — Cambios al canónico

Para no olvidarlos, los cambios al `db/erp_schema.sql` derivados de estos
requisitos son:

1. `ALTER TABLE price_list_item ADD COLUMN margin_pct NUMERIC(7,4) NOT NULL DEFAULT 0;`
2. `ALTER TABLE price_list_item ADD COLUMN out_of_margin BOOLEAN NOT NULL DEFAULT false;`
3. `ALTER TABLE price_list ADD COLUMN customer_category_id BIGINT REFERENCES customer_category(id);`
4. Nueva tabla `price_bulk_op` (id, company_id, executed_by, executed_at, description, filter_json, action_json).
5. Parámetros nuevos en `company_param` (claves):
   - `accounting.fx_gain_account_id`
   - `accounting.fx_loss_account_id`
   - `accounting.fx_unrealized_account_id`
   - `pricing.default_sale_list_id`
   - `pricing.margin_floor_pct_default`

Estos cambios **no** se aplican aquí; cada sprint los introducirá en su
migración Prisma correspondiente con su entrada en `product_price_history`,
seed y tests.
