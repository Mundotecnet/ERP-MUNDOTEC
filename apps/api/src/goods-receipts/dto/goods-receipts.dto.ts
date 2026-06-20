import { BadRequestException } from '@nestjs/common';

export interface CreateReceiptLineBody {
  productId?: unknown;
  quantity?: unknown;
  unitCost?: unknown;
}

export interface ParsedCreateReceiptLine {
  productId: bigint;
  quantity: string;
  /** Si null, el service toma el costo de la línea de OC. Obligatorio si no hay OC. */
  unitCost: string | null;
}

export interface CreateGoodsReceiptBody {
  purchaseOrderId?: unknown;
  warehouseId?: unknown;
  receiptNumber?: unknown;
  receiptDate?: unknown;
  lines?: unknown;
}

export interface ParsedCreateGoodsReceipt {
  purchaseOrderId: bigint | null;
  warehouseId: bigint;
  receiptNumber: string;
  receiptDate: Date | null;
  lines: ParsedCreateReceiptLine[];
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

function positiveDecimal(value: unknown, name: string): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) {
      throw new BadRequestException(`Campo "${name}" debe ser > 0.`);
    }
    return value.toString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+(\.\d{1,4})?$/.test(trimmed) || /^0(\.0+)?$/.test(trimmed)) {
      throw new BadRequestException(
        `Campo "${name}" debe ser un decimal > 0 con hasta 4 decimales.`,
      );
    }
    return trimmed;
  }
  throw new BadRequestException(`Campo "${name}" debe ser número o string decimal.`);
}

function nonNegativeDecimal(value: unknown, name: string): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new BadRequestException(`Campo "${name}" debe ser un decimal >= 0.`);
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

function optionalDate(value: unknown, name: string): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    throw new BadRequestException(`Campo "${name}" debe ser un ISO date string.`);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`Campo "${name}" no es una fecha válida.`);
  }
  return d;
}

function parseLineBody(raw: unknown, idx: number): ParsedCreateReceiptLine {
  if (raw === null || typeof raw !== 'object') {
    throw new BadRequestException(`Línea #${idx + 1} debe ser un objeto.`);
  }
  const r = raw as CreateReceiptLineBody;
  return {
    productId: requireBigInt(r.productId, `lines[${idx}].productId`),
    quantity: positiveDecimal(r.quantity, `lines[${idx}].quantity`),
    unitCost:
      r.unitCost === undefined || r.unitCost === null
        ? null
        : nonNegativeDecimal(r.unitCost, `lines[${idx}].unitCost`),
  };
}

export function parseCreateGoodsReceiptBody(
  body: CreateGoodsReceiptBody,
): ParsedCreateGoodsReceipt {
  if (!Array.isArray(body.lines)) {
    throw new BadRequestException('Campo "lines" debe ser un arreglo.');
  }
  if (body.lines.length === 0) {
    throw new BadRequestException('Campo "lines" debe tener al menos una línea.');
  }
  return {
    purchaseOrderId: nullableBigInt(body.purchaseOrderId, 'purchaseOrderId'),
    warehouseId: requireBigInt(body.warehouseId, 'warehouseId'),
    receiptNumber: requireString(body.receiptNumber, 'receiptNumber', 30),
    receiptDate: optionalDate(body.receiptDate, 'receiptDate'),
    lines: body.lines.map((raw, idx) => parseLineBody(raw, idx)),
  };
}

export interface ListGoodsReceiptsQuery {
  purchaseOrderId?: string;
  warehouseId?: string;
  from?: string;
  to?: string;
}

export interface ParsedListGoodsReceiptsQuery {
  purchaseOrderId: bigint | null;
  warehouseId: bigint | null;
  from: Date | null;
  to: Date | null;
}

export function parseListGoodsReceiptsQuery(
  q: ListGoodsReceiptsQuery,
): ParsedListGoodsReceiptsQuery {
  return {
    purchaseOrderId: q.purchaseOrderId ? requireBigInt(q.purchaseOrderId, 'purchaseOrderId') : null,
    warehouseId: q.warehouseId ? requireBigInt(q.warehouseId, 'warehouseId') : null,
    from: optionalDate(q.from, 'from'),
    to: optionalDate(q.to, 'to'),
  };
}
