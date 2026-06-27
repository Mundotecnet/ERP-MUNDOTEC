import { BadRequestException } from '@nestjs/common';

// HU-11.2 / PR-34 — DTO de actualización de precios con 3 niveles.
//
// Payload aceptado:
// {
//   costPrice?: string,         // costo compartido del producto
//   minMarginPct?: string,      // piso aceptable (fracción [0,1))
//   reason?: string,            // motivo libre (≤ 250 chars)
//   levels?: [                   // 0..3 niveles a actualizar
//     { priceListId: string, salePrice?: string, marginPct?: string },
//     ...
//   ]
// }
// Validaciones:
// - Al menos uno de los campos top-level debe venir.
// - Si llega `levels`, cada entrada debe tener priceListId y al menos uno
//   de salePrice/marginPct.
// - Los `priceListId` se verifican multi-tenant en el service.

export interface UpdatePricingLevelBody {
  priceListId?: unknown;
  salePrice?: unknown;
  marginPct?: unknown;
}

export interface UpdatePricingBody {
  costPrice?: unknown;
  minMarginPct?: unknown;
  reason?: unknown;
  levels?: unknown;
}

export interface ParsedUpdatePricingLevel {
  priceListId: bigint;
  salePrice?: string;
  marginPct?: string;
}

export interface ParsedUpdatePricing {
  costPrice?: string;
  minMarginPct?: string;
  reason?: string;
  levels?: ParsedUpdatePricingLevel[];
}

function asPositiveDecimal(value: unknown, name: string, scale: number): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new BadRequestException(`Campo "${name}" debe ser un decimal positivo.`);
    }
    return value.toString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const rx = new RegExp(`^\\d+(\\.\\d{1,${scale}})?$`);
    if (!rx.test(trimmed)) {
      throw new BadRequestException(
        `Campo "${name}" debe ser un decimal positivo con hasta ${scale} decimales.`,
      );
    }
    return trimmed;
  }
  throw new BadRequestException(`Campo "${name}" debe ser número o string decimal.`);
}

function asMarginFraction(value: unknown, name: string): string {
  const s = asPositiveDecimal(value, name, 4);
  const n = Number(s);
  if (!(n >= 0 && n < 1)) {
    throw new BadRequestException(`Campo "${name}" debe estar en el rango [0, 1).`);
  }
  return s;
}

function asBigInt(value: unknown, name: string): bigint {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return BigInt(value);
  }
  throw new BadRequestException(`Campo "${name}" debe ser un id válido.`);
}

function parseLevel(raw: unknown, index: number): ParsedUpdatePricingLevel {
  if (typeof raw !== 'object' || raw === null) {
    throw new BadRequestException(`Nivel #${index + 1}: debe ser un objeto.`);
  }
  const lvl = raw as UpdatePricingLevelBody;
  if (lvl.priceListId === undefined) {
    throw new BadRequestException(`Nivel #${index + 1}: falta "priceListId".`);
  }
  const out: ParsedUpdatePricingLevel = {
    priceListId: asBigInt(lvl.priceListId, `levels[${index}].priceListId`),
  };
  if (lvl.salePrice !== undefined) {
    out.salePrice = asPositiveDecimal(lvl.salePrice, `levels[${index}].salePrice`, 4);
  }
  if (lvl.marginPct !== undefined) {
    out.marginPct = asMarginFraction(lvl.marginPct, `levels[${index}].marginPct`);
  }
  if (out.salePrice === undefined && out.marginPct === undefined) {
    throw new BadRequestException(
      `Nivel #${index + 1}: debe enviar al menos "salePrice" o "marginPct".`,
    );
  }
  return out;
}

export function parseUpdatePricingBody(body: UpdatePricingBody): ParsedUpdatePricing {
  const out: ParsedUpdatePricing = {};
  if (body.costPrice !== undefined) {
    out.costPrice = asPositiveDecimal(body.costPrice, 'costPrice', 4);
  }
  if (body.minMarginPct !== undefined) {
    out.minMarginPct = asMarginFraction(body.minMarginPct, 'minMarginPct');
  }
  if (body.reason !== undefined) {
    if (typeof body.reason !== 'string') {
      throw new BadRequestException(`Campo "reason" debe ser texto.`);
    }
    const trimmed = body.reason.trim();
    if (trimmed.length > 250) {
      throw new BadRequestException(`Campo "reason" excede 250 caracteres.`);
    }
    if (trimmed.length > 0) out.reason = trimmed;
  }
  if (body.levels !== undefined) {
    if (!Array.isArray(body.levels)) {
      throw new BadRequestException(`Campo "levels" debe ser arreglo.`);
    }
    if (body.levels.length === 0) {
      throw new BadRequestException(`Campo "levels" no puede estar vacío.`);
    }
    if (body.levels.length > 3) {
      throw new BadRequestException(`Campo "levels" admite máximo 3 entradas.`);
    }
    out.levels = body.levels.map((raw, i) => parseLevel(raw, i));
    // Sin priceListId repetido.
    const ids = out.levels.map((l) => l.priceListId.toString());
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException(`Campo "levels": no se admiten priceListId repetidos.`);
    }
  }
  if (
    out.costPrice === undefined &&
    out.minMarginPct === undefined &&
    (out.levels === undefined || out.levels.length === 0)
  ) {
    throw new BadRequestException('Debe enviar al menos uno: costPrice, minMarginPct o levels.');
  }
  return out;
}
