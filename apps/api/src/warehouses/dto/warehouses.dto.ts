import { BadRequestException } from '@nestjs/common';

export interface CreateWarehouseBody {
  code?: unknown;
  name?: unknown;
  branchId?: unknown;
  isActive?: unknown;
}

export interface ParsedCreateWarehouse {
  code: string;
  name: string;
  branchId: bigint | null;
  isActive: boolean;
}

export interface UpdateWarehouseBody {
  code?: unknown;
  name?: unknown;
  branchId?: unknown;
  isActive?: unknown;
}

export interface ParsedUpdateWarehouse {
  code?: string;
  name?: string;
  /** undefined = no se toca; null = desasignar. */
  branchId?: bigint | null;
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

function asNullableBigInt(value: unknown, name: string): bigint | null {
  if (value === null) return null;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new BadRequestException(`Campo "${name}" debe ser string, number o null.`);
  }
  try {
    return BigInt(value);
  } catch {
    throw new BadRequestException(`Campo "${name}" no es un número válido.`);
  }
}

export function parseCreateWarehouseBody(body: CreateWarehouseBody): ParsedCreateWarehouse {
  return {
    code: requireString(body.code, 'code', 20),
    name: requireString(body.name, 'name', 120),
    branchId:
      body.branchId === undefined || body.branchId === null
        ? null
        : asNullableBigInt(body.branchId, 'branchId'),
    isActive: body.isActive === undefined ? true : asBoolean(body.isActive, 'isActive'),
  };
}

export function parseUpdateWarehouseBody(body: UpdateWarehouseBody): ParsedUpdateWarehouse {
  const out: ParsedUpdateWarehouse = {};
  const code = optionalString(body.code, 'code', 20);
  if (code !== undefined) out.code = code;
  const name = optionalString(body.name, 'name', 120);
  if (name !== undefined) out.name = name;
  if (body.branchId !== undefined) out.branchId = asNullableBigInt(body.branchId, 'branchId');
  const isActive = optionalBoolean(body.isActive, 'isActive');
  if (isActive !== undefined) out.isActive = isActive;
  if (Object.keys(out).length === 0) {
    throw new BadRequestException('No se recibió ningún campo a actualizar.');
  }
  return out;
}
