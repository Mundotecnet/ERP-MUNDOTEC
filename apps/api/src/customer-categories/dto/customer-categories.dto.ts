import { BadRequestException } from '@nestjs/common';

export interface CreateCustomerCategoryBody {
  code?: unknown;
  name?: unknown;
}

export interface ParsedCreateCustomerCategory {
  code: string;
  name: string;
}

export interface UpdateCustomerCategoryBody {
  code?: unknown;
  name?: unknown;
}

export interface ParsedUpdateCustomerCategory {
  code?: string;
  name?: string;
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

function asCode(value: unknown): string {
  const s = requireString(value, 'code', 5).toUpperCase();
  if (!/^[A-Z0-9]{1,5}$/.test(s)) {
    throw new BadRequestException('Campo "code" admite mayúsculas y dígitos (máx. 5).');
  }
  return s;
}

export function parseCreateCustomerCategoryBody(
  body: CreateCustomerCategoryBody,
): ParsedCreateCustomerCategory {
  return {
    code: asCode(body.code),
    name: requireString(body.name, 'name', 80),
  };
}

export function parseUpdateCustomerCategoryBody(
  body: UpdateCustomerCategoryBody,
): ParsedUpdateCustomerCategory {
  const out: ParsedUpdateCustomerCategory = {};
  if (body.code !== undefined) out.code = asCode(body.code);
  const name = optionalString(body.name, 'name', 80);
  if (name !== undefined) out.name = name;
  if (Object.keys(out).length === 0) {
    throw new BadRequestException('No se recibió ningún campo a actualizar.');
  }
  return out;
}
