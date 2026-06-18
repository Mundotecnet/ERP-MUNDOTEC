import { BadRequestException } from '@nestjs/common';

export interface CreateProductCategoryBody {
  name?: unknown;
  parentId?: unknown;
  isActive?: unknown;
}

export interface ParsedCreateProductCategory {
  name: string;
  parentId: bigint | null;
  isActive: boolean;
}

export interface UpdateProductCategoryBody {
  name?: unknown;
  parentId?: unknown;
  isActive?: unknown;
}

export interface ParsedUpdateProductCategory {
  name?: string;
  /** undefined = no se toca; null = pasa a raíz. */
  parentId?: bigint | null;
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

export function parseCreateProductCategoryBody(
  body: CreateProductCategoryBody,
): ParsedCreateProductCategory {
  return {
    name: requireString(body.name, 'name', 120),
    parentId:
      body.parentId === undefined || body.parentId === null
        ? null
        : asNullableBigInt(body.parentId, 'parentId'),
    isActive: body.isActive === undefined ? true : asBoolean(body.isActive, 'isActive'),
  };
}

export function parseUpdateProductCategoryBody(
  body: UpdateProductCategoryBody,
): ParsedUpdateProductCategory {
  const out: ParsedUpdateProductCategory = {};
  const name = optionalString(body.name, 'name', 120);
  if (name !== undefined) out.name = name;
  if (body.parentId !== undefined) out.parentId = asNullableBigInt(body.parentId, 'parentId');
  const isActive = optionalBoolean(body.isActive, 'isActive');
  if (isActive !== undefined) out.isActive = isActive;
  if (Object.keys(out).length === 0) {
    throw new BadRequestException('No se recibió ningún campo a actualizar.');
  }
  return out;
}
