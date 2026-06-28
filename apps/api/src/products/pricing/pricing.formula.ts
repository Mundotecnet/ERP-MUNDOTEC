import { Prisma } from '@prisma/client';

// HU-11.1 / PR-35 — fórmulas puras, margen SOBRE el precio de venta.
//
//   margin = (price - cost) / price
//   price  = cost / (1 - margin)   (redondeado a 2 decimales)
//
// El precio de venta se redondea a 2 decimales tanto al calcularlo desde
// margen como al guardarlo desde el cliente. El costo y el margen mantienen
// 4 decimales de precisión interna. Cuando se calcula margen desde un precio
// redondeado, se guarda el margen EFECTIVO de ese precio (no la intención
// del usuario), garantizando que el trío (cost, margin, price) siempre cuadre.

export const PRICE_SCALE = 2;
export const MARGIN_SCALE = 4;
export const MARGIN_MAX = new Prisma.Decimal('0.9999'); // CHECK: margin < 1

export function toDecimal(v: Prisma.Decimal | number | string): Prisma.Decimal {
  return v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v);
}

/** Redondea cualquier precio entrante al PRICE_SCALE canónico (HALF_UP). */
export function roundPrice(price: Prisma.Decimal | number | string): Prisma.Decimal {
  return toDecimal(price).toDecimalPlaces(PRICE_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Calcula el precio de venta a partir de costo + margen objetivo, redondeado
 * a PRICE_SCALE. Si `cost = 0` lanza error (el precio no se puede derivar).
 */
export function priceFromMargin(
  cost: Prisma.Decimal | number | string,
  margin: Prisma.Decimal | number | string,
): Prisma.Decimal {
  const c = toDecimal(cost);
  const m = toDecimal(margin);
  if (m.gte(1)) {
    throw new Error('El margen debe ser estrictamente menor a 1 (100 %).');
  }
  if (m.lt(0)) {
    throw new Error('El margen no puede ser negativo.');
  }
  if (c.lte(0)) {
    throw new Error('No se puede derivar precio desde margen con costo cero.');
  }
  return roundPrice(c.div(new Prisma.Decimal(1).sub(m)));
}

/**
 * Calcula el margen efectivo a partir de costo + precio.
 * Si `price <= 0` el margen es 0 (no hay margen sobre venta nula).
 * Si `price < cost` el margen es negativo — se rechaza.
 *
 * El llamador debe pasar el precio YA redondeado al PRICE_SCALE para que el
 * margen efectivo refleje el valor que va a quedar guardado.
 */
export function marginFromPrice(
  cost: Prisma.Decimal | number | string,
  price: Prisma.Decimal | number | string,
): Prisma.Decimal {
  const c = toDecimal(cost);
  const p = toDecimal(price);
  if (p.lte(0)) return new Prisma.Decimal(0).toDecimalPlaces(MARGIN_SCALE);
  if (p.lt(c)) {
    throw new Error('El precio no puede ser menor al costo (margen negativo no soportado).');
  }
  const raw = p.sub(c).div(p);
  // Capamos a 0.9999 para respetar el CHECK margin_pct < 1 (cost=0 cae aquí).
  const capped = raw.gte(MARGIN_MAX) ? MARGIN_MAX : raw;
  return capped.toDecimalPlaces(MARGIN_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Verifica que un par (price, margin) sea consistente con un costo dado tras
 * el redondeo del precio a PRICE_SCALE: `priceFromMargin(cost, margin)` debe
 * coincidir con `roundPrice(price)`.
 *
 * Esta es la consistencia "post-redondeo": tolera la pequeña pérdida del
 * redondeo a 2 decimales (que para precios chicos rompería una tolerancia
 * sobre margen). Se usa cuando el cliente envía ambos campos.
 */
export function isConsistent(
  cost: Prisma.Decimal | number | string,
  price: Prisma.Decimal | number | string,
  margin: Prisma.Decimal | number | string,
): boolean {
  const c = toDecimal(cost);
  const sIn = toDecimal(price);
  const mIn = toDecimal(margin);
  if (sIn.lte(0)) return mIn.eq(0);
  // priceFromMargin valida el rango del margen; si está fuera, no es
  // consistente con ningún precio.
  if (mIn.gte(1) || mIn.lt(0)) return false;
  if (c.lte(0)) {
    // Sin costo, el margen "intencional" debe ser 0 y el precio se acepta
    // tal cual viene.
    return mIn.eq(0);
  }
  const expected = priceFromMargin(c, mIn);
  return expected.eq(roundPrice(sIn));
}

/**
 * `out_of_margin` flag — true cuando el margen real es estrictamente menor al
 * piso aceptable definido en el producto. Si `minMargin = 0`, nunca está fuera
 * (semántica: "no hay piso configurado").
 */
export function isOutOfMargin(
  margin: Prisma.Decimal | number | string,
  minMargin: Prisma.Decimal | number | string,
): boolean {
  const m = toDecimal(margin);
  const min = toDecimal(minMargin);
  if (min.lte(0)) return false;
  return m.lt(min);
}
