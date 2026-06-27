import { BadRequestException } from '@nestjs/common';

export interface UpdatePricingBody {
  costPrice?: unknown;
  salePrice?: unknown;
  marginPct?: unknown;
  minMarginPct?: unknown;
  reason?: unknown;
}

export interface ParsedUpdatePricing {
  costPrice?: string;
  salePrice?: string;
  marginPct?: string;
  minMarginPct?: string;
  reason?: string;
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

export function parseUpdatePricingBody(body: UpdatePricingBody): ParsedUpdatePricing {
  const out: ParsedUpdatePricing = {};
  if (body.costPrice !== undefined)
    out.costPrice = asPositiveDecimal(body.costPrice, 'costPrice', 4);
  if (body.salePrice !== undefined)
    out.salePrice = asPositiveDecimal(body.salePrice, 'salePrice', 4);
  if (body.marginPct !== undefined) out.marginPct = asMarginFraction(body.marginPct, 'marginPct');
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
  if (
    out.costPrice === undefined &&
    out.salePrice === undefined &&
    out.marginPct === undefined &&
    out.minMarginPct === undefined
  ) {
    throw new BadRequestException(
      'Debe enviar al menos uno: costPrice, salePrice, marginPct o minMarginPct.',
    );
  }
  return out;
}
