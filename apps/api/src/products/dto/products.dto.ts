import { BadRequestException } from '@nestjs/common';

export const TRACKING_TYPES = ['NONE', 'SERIAL', 'LOT'] as const;
export type TrackingType = (typeof TRACKING_TYPES)[number];

// PR-39 — SKU es automático: nunca viene del cliente. Si llega, se ignora.
// El service lo asigna desde document_sequence(PRODUCT_SKU) atómicamente.
export interface CreateProductBody {
  // sku?: unknown   // ← deliberadamente NO se acepta
  barcode?: unknown;
  name?: unknown;
  description?: unknown;
  categoryId?: unknown;
  uomId?: unknown;
  taxId?: unknown;
  costPrice?: unknown;
  salePrice?: unknown;
  priceCurrency?: unknown;
  isInventoried?: unknown;
  trackingType?: unknown;
  warrantyMonths?: unknown;
  minStock?: unknown;
  maxStock?: unknown;
  isActive?: unknown;
  departmentId?: unknown;
}

export interface ParsedCreateProduct {
  barcode: string | null;
  name: string;
  description: string | null;
  categoryId: bigint | null;
  uomId: bigint;
  taxId: bigint | null;
  costPrice: string;
  salePrice: string;
  priceCurrency: string;
  isInventoried: boolean;
  trackingType: TrackingType;
  warrantyMonths: number;
  minStock: string;
  maxStock: string;
  isActive: boolean;
  departmentId: bigint | null;
}

export type UpdateProductBody = CreateProductBody;

export interface ParsedUpdateProduct {
  // sku no se modifica vía PATCH; el cliente nunca lo manda y el service no
  // lo respeta aunque llegue.
  barcode?: string | null;
  name?: string;
  description?: string | null;
  categoryId?: bigint | null;
  uomId?: bigint;
  taxId?: bigint | null;
  costPrice?: string;
  salePrice?: string;
  priceCurrency?: string;
  isInventoried?: boolean;
  trackingType?: TrackingType;
  warrantyMonths?: number;
  minStock?: string;
  maxStock?: string;
  isActive?: boolean;
  departmentId?: bigint | null;
}

function requireString(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`Campo "${name}" debe ser un texto no vacío.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new BadRequestException(`Campo "${name}" excede ${max} caracteres.`);
  }
  return trimmed;
}

function optionalString(value: unknown, name: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, name, max);
}

function nullableString(value: unknown, name: string, max: number): string | null {
  if (value === null || value === undefined || value === '') return null;
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

function requireBigInt(value: unknown, name: string): bigint {
  if (value === null || value === undefined) {
    throw new BadRequestException(`Campo "${name}" es requerido.`);
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new BadRequestException(`Campo "${name}" debe ser string o number.`);
  }
  try {
    return BigInt(value);
  } catch {
    throw new BadRequestException(`Campo "${name}" no es un número válido.`);
  }
}

function nullableBigInt(value: unknown, name: string): bigint | null {
  if (value === null || value === undefined) return null;
  return requireBigInt(value, name);
}

function asDecimalString(value: unknown, name: string): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new BadRequestException(`Campo "${name}" debe ser un número finito.`);
    }
    if (value < 0) {
      throw new BadRequestException(`Campo "${name}" no puede ser negativo.`);
    }
    return value.toString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+(\.\d{1,4})?$/.test(trimmed)) {
      throw new BadRequestException(
        `Campo "${name}" debe ser un decimal positivo con hasta 4 decimales.`,
      );
    }
    return trimmed;
  }
  throw new BadRequestException(`Campo "${name}" debe ser número o string decimal.`);
}

function optionalDecimal(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  return asDecimalString(value, name);
}

function asInt(value: unknown, name: string, min: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new BadRequestException(`Campo "${name}" debe ser un entero.`);
  }
  if (value < min) {
    throw new BadRequestException(`Campo "${name}" debe ser >= ${min}.`);
  }
  return value;
}

function optionalInt(value: unknown, name: string, min: number): number | undefined {
  if (value === undefined) return undefined;
  return asInt(value, name, min);
}

function asTrackingType(value: unknown): TrackingType {
  if (typeof value !== 'string' || !TRACKING_TYPES.includes(value as TrackingType)) {
    throw new BadRequestException(
      `Campo "trackingType" debe ser uno de: ${TRACKING_TYPES.join(', ')}.`,
    );
  }
  return value as TrackingType;
}

function optionalTrackingType(value: unknown): TrackingType | undefined {
  if (value === undefined) return undefined;
  return asTrackingType(value);
}

function asCurrencyCode(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) {
    throw new BadRequestException(`Campo "${name}" debe ser un código ISO de 3 letras (ej. USD).`);
  }
  return value;
}

function optionalCurrencyCode(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  return asCurrencyCode(value, name);
}

export function parseCreateProductBody(body: CreateProductBody): ParsedCreateProduct {
  return {
    barcode: nullableString(body.barcode, 'barcode', 60),
    name: requireString(body.name, 'name', 200),
    description:
      body.description === undefined
        ? null
        : nullableString(body.description, 'description', 65535),
    categoryId: nullableBigInt(body.categoryId, 'categoryId'),
    uomId: requireBigInt(body.uomId, 'uomId'),
    taxId: nullableBigInt(body.taxId, 'taxId'),
    costPrice: body.costPrice === undefined ? '0' : asDecimalString(body.costPrice, 'costPrice'),
    salePrice: body.salePrice === undefined ? '0' : asDecimalString(body.salePrice, 'salePrice'),
    priceCurrency:
      body.priceCurrency === undefined
        ? 'USD'
        : asCurrencyCode(body.priceCurrency, 'priceCurrency'),
    isInventoried:
      body.isInventoried === undefined ? true : asBoolean(body.isInventoried, 'isInventoried'),
    trackingType: body.trackingType === undefined ? 'NONE' : asTrackingType(body.trackingType),
    warrantyMonths:
      body.warrantyMonths === undefined ? 0 : asInt(body.warrantyMonths, 'warrantyMonths', 0),
    minStock: body.minStock === undefined ? '0' : asDecimalString(body.minStock, 'minStock'),
    maxStock: body.maxStock === undefined ? '0' : asDecimalString(body.maxStock, 'maxStock'),
    isActive: body.isActive === undefined ? true : asBoolean(body.isActive, 'isActive'),
    departmentId: nullableBigInt(body.departmentId, 'departmentId'),
  };
}

export function parseUpdateProductBody(body: UpdateProductBody): ParsedUpdateProduct {
  const out: ParsedUpdateProduct = {};
  // PR-39: si el cliente envía sku en el body se ignora silenciosamente.
  if (body.barcode !== undefined) out.barcode = nullableString(body.barcode, 'barcode', 60);
  const name = optionalString(body.name, 'name', 200);
  if (name !== undefined) out.name = name;
  if (body.description !== undefined) {
    out.description = nullableString(body.description, 'description', 65535);
  }
  if (body.categoryId !== undefined) out.categoryId = nullableBigInt(body.categoryId, 'categoryId');
  if (body.uomId !== undefined) out.uomId = requireBigInt(body.uomId, 'uomId');
  if (body.taxId !== undefined) out.taxId = nullableBigInt(body.taxId, 'taxId');
  const costPrice = optionalDecimal(body.costPrice, 'costPrice');
  if (costPrice !== undefined) out.costPrice = costPrice;
  const salePrice = optionalDecimal(body.salePrice, 'salePrice');
  if (salePrice !== undefined) out.salePrice = salePrice;
  const priceCurrency = optionalCurrencyCode(body.priceCurrency, 'priceCurrency');
  if (priceCurrency !== undefined) out.priceCurrency = priceCurrency;
  const isInventoried = optionalBoolean(body.isInventoried, 'isInventoried');
  if (isInventoried !== undefined) out.isInventoried = isInventoried;
  const trackingType = optionalTrackingType(body.trackingType);
  if (trackingType !== undefined) out.trackingType = trackingType;
  const warrantyMonths = optionalInt(body.warrantyMonths, 'warrantyMonths', 0);
  if (warrantyMonths !== undefined) out.warrantyMonths = warrantyMonths;
  const minStock = optionalDecimal(body.minStock, 'minStock');
  if (minStock !== undefined) out.minStock = minStock;
  const maxStock = optionalDecimal(body.maxStock, 'maxStock');
  if (maxStock !== undefined) out.maxStock = maxStock;
  const isActive = optionalBoolean(body.isActive, 'isActive');
  if (isActive !== undefined) out.isActive = isActive;
  if (body.departmentId !== undefined)
    out.departmentId = nullableBigInt(body.departmentId, 'departmentId');
  if (Object.keys(out).length === 0) {
    throw new BadRequestException('No se recibió ningún campo a actualizar.');
  }
  return out;
}
