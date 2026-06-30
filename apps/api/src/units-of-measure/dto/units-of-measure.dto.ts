import { BadRequestException } from '@nestjs/common';

export interface CreateUomBody {
  code?: unknown;
  name?: unknown;
  isActive?: unknown;
}

export interface ParsedCreateUom {
  code: string;
  name: string;
  isActive: boolean;
}

export interface UpdateUomBody {
  code?: unknown;
  name?: unknown;
  isActive?: unknown;
}

export interface ParsedUpdateUom {
  code?: string;
  name?: string;
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
    throw new BadRequestException(`Campo "${name}" debe ser booleano.`);
  }
  return value;
}

function asUomCode(value: unknown): string {
  const s = requireString(value, 'code', 10).toUpperCase();
  if (!/^[A-Z0-9_-]{1,10}$/.test(s)) {
    throw new BadRequestException('Campo "code" admite mayúsculas, dígitos, guion y guion bajo.');
  }
  return s;
}

export function parseCreateUomBody(body: CreateUomBody): ParsedCreateUom {
  return {
    code: asUomCode(body.code),
    name: requireString(body.name, 'name', 60),
    isActive: body.isActive === undefined ? true : asBoolean(body.isActive, 'isActive'),
  };
}

export function parseUpdateUomBody(body: UpdateUomBody): ParsedUpdateUom {
  const out: ParsedUpdateUom = {};
  if (body.code !== undefined) out.code = asUomCode(body.code);
  const name = optionalString(body.name, 'name', 60);
  if (name !== undefined) out.name = name;
  if (body.isActive !== undefined) out.isActive = asBoolean(body.isActive, 'isActive');
  if (Object.keys(out).length === 0) {
    throw new BadRequestException('No se recibió ningún campo a actualizar.');
  }
  return out;
}
