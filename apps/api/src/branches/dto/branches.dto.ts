import { BadRequestException } from '@nestjs/common';

export interface CreateBranchBody {
  code?: unknown;
  name?: unknown;
  address?: unknown;
  phone?: unknown;
  isActive?: unknown;
}

export interface ParsedCreateBranch {
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
}

export interface UpdateBranchBody {
  code?: unknown;
  name?: unknown;
  address?: unknown;
  phone?: unknown;
  isActive?: unknown;
}

export interface ParsedUpdateBranch {
  code?: string;
  name?: string;
  address?: string | null;
  phone?: string | null;
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

function nullableString(value: unknown, name: string, max: number): string | null {
  if (value === null || value === '') return null;
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

export function parseCreateBranchBody(body: CreateBranchBody): ParsedCreateBranch {
  return {
    code: requireString(body.code, 'code', 20),
    name: requireString(body.name, 'name', 150),
    address: body.address === undefined ? null : nullableString(body.address, 'address', 300),
    phone: body.phone === undefined ? null : nullableString(body.phone, 'phone', 50),
    isActive: body.isActive === undefined ? true : asBoolean(body.isActive, 'isActive'),
  };
}

export function parseUpdateBranchBody(body: UpdateBranchBody): ParsedUpdateBranch {
  const out: ParsedUpdateBranch = {};
  const code = optionalString(body.code, 'code', 20);
  if (code !== undefined) out.code = code;
  const name = optionalString(body.name, 'name', 150);
  if (name !== undefined) out.name = name;
  if (body.address !== undefined) out.address = nullableString(body.address, 'address', 300);
  if (body.phone !== undefined) out.phone = nullableString(body.phone, 'phone', 50);
  const isActive = optionalBoolean(body.isActive, 'isActive');
  if (isActive !== undefined) out.isActive = isActive;
  if (Object.keys(out).length === 0) {
    throw new BadRequestException('No se recibió ningún campo a actualizar.');
  }
  return out;
}
