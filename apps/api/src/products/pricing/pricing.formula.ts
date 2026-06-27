import { Prisma } from '@prisma/client';

// HU-11.1 — fórmulas puras, margen SOBRE el precio de venta.
//
//   margin = (price - cost) / price
//   price  = cost / (1 - margin)
//
// Se usa `Prisma.Decimal` para evitar redondeos de IEEE-754. La precisión de
// salida se redondea a 4 decimales (precio) o 4 decimales (margen) para que
// coincida con `NUMERIC(18,4)` / `NUMERIC(7,4)` del canónico.

export const PRICE_SCALE = 4;
export const MARGIN_SCALE = 4;
export const MARGIN_MAX = new Prisma.Decimal('0.9999'); // CHECK: margin < 1
export const CONSISTENCY_TOLERANCE = new Prisma.Decimal('0.0001');

export function toDecimal(v: Prisma.Decimal | number | string): Prisma.Decimal {
  return v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v);
}

/**
 * Calcula el precio de venta a partir de costo + margen objetivo.
 * Si `cost = 0` lanza error: el precio no se puede derivar (resultado: 0).
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
  return c
    .div(new Prisma.Decimal(1).sub(m))
    .toDecimalPlaces(PRICE_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Calcula el margen efectivo a partir de costo + precio.
 * Si `price <= 0` el margen es 0 (no hay margen sobre venta nula).
 * Si `price < cost` el margen es negativo — se rechaza (uso explícito de
 * promociones bajo costo no soportado en PR-32).
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
 * Verifica que un par (price, margin) sea consistente con un costo dado,
 * dentro de la tolerancia `CONSISTENCY_TOLERANCE`. Útil cuando el cliente
 * manda los tres campos y el server debe rechazar combinaciones inconsistentes.
 */
export function isConsistent(
  cost: Prisma.Decimal | number | string,
  price: Prisma.Decimal | number | string,
  margin: Prisma.Decimal | number | string,
): boolean {
  const c = toDecimal(cost);
  const p = toDecimal(price);
  const m = toDecimal(margin);
  if (p.lte(0)) return m.eq(0);
  const derivedMargin = marginFromPrice(c, p);
  return derivedMargin.sub(m).abs().lte(CONSISTENCY_TOLERANCE);
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
