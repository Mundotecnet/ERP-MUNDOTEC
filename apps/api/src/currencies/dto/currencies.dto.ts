import { BadRequestException } from '@nestjs/common';

export interface CreateCurrencyBody {
  code?: unknown;
  name?: unknown;
  symbol?: unknown;
}

export interface ParsedCreateCurrency {
  code: string;
  name: string;
  symbol: string | null;
}

export interface UpdateCurrencyBody {
  name?: unknown;
  symbol?: unknown;
}

export interface ParsedUpdateCurrency {
  name?: string;
  symbol?: string | null;
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

function optionalString(value: unknown, name: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, name, max);
}

function nullableString(value: unknown, name: string, max: number): string | null {
  if (value === null || value === '') return null;
  return requireString(value, name, max);
}

function asIsoCode(value: unknown): string {
  const s = requireString(value, 'code', 3);
  if (!/^[A-Z]{3}$/.test(s)) {
    throw new BadRequestException(
      'Campo "code" debe ser un código ISO-4217 de 3 letras mayúsculas (ej. CRC, USD).',
    );
  }
  return s;
}

export function parseCreateCurrencyBody(body: CreateCurrencyBody): ParsedCreateCurrency {
  return {
    code: asIsoCode(body.code),
    name: requireString(body.name, 'name', 60),
    symbol: body.symbol === undefined ? null : nullableString(body.symbol, 'symbol', 6),
  };
}

export function parseUpdateCurrencyBody(body: UpdateCurrencyBody): ParsedUpdateCurrency {
  const out: ParsedUpdateCurrency = {};
  const name = optionalString(body.name, 'name', 60);
  if (name !== undefined) out.name = name;
  if (body.symbol !== undefined) out.symbol = nullableString(body.symbol, 'symbol', 6);
  if (Object.keys(out).length === 0) {
    throw new BadRequestException('No se recibió ningún campo a actualizar.');
  }
  return out;
}

export function parseCurrencyCodeParam(value: string): string {
  return asIsoCode(value.toUpperCase());
}
