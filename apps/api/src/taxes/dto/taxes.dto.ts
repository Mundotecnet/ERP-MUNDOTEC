import { BadRequestException } from '@nestjs/common';

export interface CreateTaxBody {
  name?: unknown;
  rate?: unknown;
  isActive?: unknown;
}

export interface ParsedCreateTax {
  name: string;
  rate: string;
  isActive: boolean;
}

export interface UpdateTaxBody {
  name?: unknown;
  rate?: unknown;
  isActive?: unknown;
}

export interface ParsedUpdateTax {
  name?: string;
  rate?: string;
  isActive?: boolean;
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

function asBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new BadRequestException(`Campo "${name}" debe ser true o false.`);
  }
  return value;
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  return asBoolean(value, name);
}

function asRate(value: unknown): string {
  let n: number;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && value.trim().length > 0) n = Number(value);
  else throw new BadRequestException('Campo "rate" debe ser numérico.');
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new BadRequestException('Campo "rate" debe estar entre 0 y 1 (porcentaje).');
  }
  return n.toFixed(4);
}

export function parseCreateTaxBody(body: CreateTaxBody): ParsedCreateTax {
  return {
    name: requireString(body.name, 'name', 60),
    rate: body.rate === undefined ? '0.0000' : asRate(body.rate),
    isActive: body.isActive === undefined ? true : asBoolean(body.isActive, 'isActive'),
  };
}

export function parseUpdateTaxBody(body: UpdateTaxBody): ParsedUpdateTax {
  const out: ParsedUpdateTax = {};
  const name = optionalString(body.name, 'name', 60);
  if (name !== undefined) out.name = name;
  if (body.rate !== undefined) out.rate = asRate(body.rate);
  const isActive = optionalBoolean(body.isActive, 'isActive');
  if (isActive !== undefined) out.isActive = isActive;
  if (Object.keys(out).length === 0) {
    throw new BadRequestException('No se recibió ningún campo a actualizar.');
  }
  return out;
}
