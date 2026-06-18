import { BadRequestException } from '@nestjs/common';

export interface CreateDepartmentBody {
  name?: unknown;
  isActive?: unknown;
}

export interface ParsedCreateDepartment {
  name: string;
  isActive: boolean;
}

export interface UpdateDepartmentBody {
  name?: unknown;
  isActive?: unknown;
}

export interface ParsedUpdateDepartment {
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
    throw new BadRequestException(`Campo "${name}" debe ser true o false.`);
  }
  return value;
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  return asBoolean(value, name);
}

export function parseCreateDepartmentBody(body: CreateDepartmentBody): ParsedCreateDepartment {
  return {
    name: requireString(body.name, 'name', 80),
    isActive: body.isActive === undefined ? true : asBoolean(body.isActive, 'isActive'),
  };
}

export function parseUpdateDepartmentBody(body: UpdateDepartmentBody): ParsedUpdateDepartment {
  const out: ParsedUpdateDepartment = {};
  const name = optionalString(body.name, 'name', 80);
  if (name !== undefined) out.name = name;
  const isActive = optionalBoolean(body.isActive, 'isActive');
  if (isActive !== undefined) out.isActive = isActive;
  if (Object.keys(out).length === 0) {
    throw new BadRequestException('No se recibió ningún campo a actualizar.');
  }
  return out;
}
