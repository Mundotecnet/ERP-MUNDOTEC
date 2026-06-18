import { BadRequestException } from '@nestjs/common';

export interface CreateExchangeRateBody {
  currencyCode?: unknown;
  rateDate?: unknown;
  rate?: unknown;
}

export interface ParsedCreateExchangeRate {
  currencyCode: string;
  rateDate: Date;
  rate: string; // Decimal en string para preservar precisión
}

export interface UpdateExchangeRateBody {
  rate?: unknown;
}

export interface ParsedUpdateExchangeRate {
  rate: string;
}

export interface ListExchangeRatesQuery {
  currencyCode?: unknown;
  from?: unknown; // YYYY-MM-DD
  to?: unknown;
}

export interface ParsedListExchangeRates {
  currencyCode?: string;
  from?: Date;
  to?: Date;
}

function requireString(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`Campo "${name}" debe ser un texto no vacío.`);
  }
  if (value.length > max) {
    throw new BadRequestException(`Campo "${name}" excede ${max} caracteres.`);
  }
  return value.trim();
}

function asIsoCode(value: unknown, name = 'currencyCode'): string {
  const s = requireString(value, name, 3);
  if (!/^[A-Z]{3}$/.test(s.toUpperCase())) {
    throw new BadRequestException(`Campo "${name}" debe ser un código ISO-4217 de 3 letras.`);
  }
  return s.toUpperCase();
}

function asYmdDate(value: unknown, name: string): Date {
  const s = requireString(value, name, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new BadRequestException(`Campo "${name}" debe estar en formato YYYY-MM-DD.`);
  }
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`Campo "${name}" no es una fecha válida.`);
  }
  return d;
}

function asDecimal(value: unknown, name: string): string {
  let n: number;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && value.trim().length > 0) n = Number(value);
  else throw new BadRequestException(`Campo "${name}" debe ser numérico.`);
  if (!Number.isFinite(n) || n <= 0) {
    throw new BadRequestException(`Campo "${name}" debe ser mayor que cero.`);
  }
  return n.toFixed(6);
}

export function parseCreateExchangeRateBody(
  body: CreateExchangeRateBody,
): ParsedCreateExchangeRate {
  return {
    currencyCode: asIsoCode(body.currencyCode),
    rateDate: asYmdDate(body.rateDate, 'rateDate'),
    rate: asDecimal(body.rate, 'rate'),
  };
}

export function parseUpdateExchangeRateBody(
  body: UpdateExchangeRateBody,
): ParsedUpdateExchangeRate {
  if (body.rate === undefined) {
    throw new BadRequestException('Campo "rate" requerido para actualizar.');
  }
  return { rate: asDecimal(body.rate, 'rate') };
}

export function parseListExchangeRatesQuery(q: ListExchangeRatesQuery): ParsedListExchangeRates {
  const out: ParsedListExchangeRates = {};
  if (q.currencyCode !== undefined) out.currencyCode = asIsoCode(q.currencyCode);
  if (q.from !== undefined) out.from = asYmdDate(q.from, 'from');
  if (q.to !== undefined) out.to = asYmdDate(q.to, 'to');
  if (out.from && out.to && out.from > out.to) {
    throw new BadRequestException('"from" debe ser anterior o igual a "to".');
  }
  return out;
}
