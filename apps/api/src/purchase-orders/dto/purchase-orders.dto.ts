import { BadRequestException } from '@nestjs/common';

export const PO_STATUSES = ['DRAFT', 'APPROVED', 'RECEIVED', 'CANCELLED'] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export interface CreateLineBody {
  productId?: unknown;
  quantity?: unknown;
  unitCost?: unknown;
  taxRate?: unknown;
}

export interface ParsedCreateLine {
  productId: bigint;
  quantity: string;
  unitCost: string;
  taxRate: string;
}

export interface CreatePurchaseOrderBody {
  supplierId?: unknown;
  branchId?: unknown;
  orderNumber?: unknown;
  orderDate?: unknown;
  expectedDate?: unknown;
  currencyCode?: unknown;
  exchangeRate?: unknown;
  notes?: unknown;
  lines?: unknown;
}

export interface ParsedCreatePurchaseOrder {
  supplierId: bigint;
  branchId: bigint | null;
  orderNumber: string;
  orderDate: Date | null;
  expectedDate: Date | null;
  currencyCode: string;
  exchangeRate: string | null;
  notes: string | null;
  lines: ParsedCreateLine[];
}

export type UpdatePurchaseOrderBody = CreatePurchaseOrderBody;

export interface ParsedUpdatePurchaseOrder {
  supplierId?: bigint;
  branchId?: bigint | null;
  orderNumber?: string;
  orderDate?: Date;
  expectedDate?: Date | null;
  currencyCode?: string;
  exchangeRate?: string;
  notes?: string | null;
  /** Si se incluye, reemplaza por completo el set de líneas (replace-all). */
  lines?: ParsedCreateLine[];
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

function positiveDecimal(value: unknown, name: string): string {
  const s = nonNegativeDecimal(value, name);
  if (/^0(\.0+)?$/.test(s)) {
    throw new BadRequestException(`Campo "${name}" debe ser > 0.`);
  }
  return s;
}

function positiveRateDecimal(value: unknown, name: string): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) {
      throw new BadRequestException(`Campo "${name}" debe ser > 0.`);
    }
    return value.toString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+(\.\d{1,6})?$/.test(trimmed) || /^0(\.0+)?$/.test(trimmed)) {
      throw new BadRequestException(
        `Campo "${name}" debe ser un decimal > 0 con hasta 6 decimales.`,
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

function parseLineBody(raw: unknown, idx: number): ParsedCreateLine {
  if (raw === null || typeof raw !== 'object') {
    throw new BadRequestException(`Línea #${idx + 1} debe ser un objeto.`);
  }
  const r = raw as CreateLineBody;
  return {
    productId: requireBigInt(r.productId, `lines[${idx}].productId`),
    quantity: positiveDecimal(r.quantity, `lines[${idx}].quantity`),
    unitCost: nonNegativeDecimal(r.unitCost, `lines[${idx}].unitCost`),
    taxRate: r.taxRate === undefined ? '0' : nonNegativeDecimal(r.taxRate, `lines[${idx}].taxRate`),
  };
}

function parseLinesArray(value: unknown, requireNonEmpty: boolean): ParsedCreateLine[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException('Campo "lines" debe ser un arreglo.');
  }
  if (requireNonEmpty && value.length === 0) {
    throw new BadRequestException('Campo "lines" debe tener al menos una línea.');
  }
  return value.map((raw, idx) => parseLineBody(raw, idx));
}

export function parseCreatePurchaseOrderBody(
  body: CreatePurchaseOrderBody,
): ParsedCreatePurchaseOrder {
  const currencyCode =
    body.currencyCode === undefined ? 'USD' : asCurrencyCode(body.currencyCode, 'currencyCode');
  return {
    supplierId: requireBigInt(body.supplierId, 'supplierId'),
    branchId: nullableBigInt(body.branchId, 'branchId'),
    orderNumber: requireString(body.orderNumber, 'orderNumber', 30),
    orderDate: optionalDate(body.orderDate, 'orderDate'),
    expectedDate: optionalDate(body.expectedDate, 'expectedDate'),
    currencyCode,
    exchangeRate:
      body.exchangeRate === undefined
        ? null
        : positiveRateDecimal(body.exchangeRate, 'exchangeRate'),
    notes: nullableString(body.notes, 'notes', 300),
    lines: parseLinesArray(body.lines, true),
  };
}

export function parseUpdatePurchaseOrderBody(
  body: UpdatePurchaseOrderBody,
): ParsedUpdatePurchaseOrder {
  const out: ParsedUpdatePurchaseOrder = {};
  if (body.supplierId !== undefined) out.supplierId = requireBigInt(body.supplierId, 'supplierId');
  if (body.branchId !== undefined) out.branchId = nullableBigInt(body.branchId, 'branchId');
  const orderNumber = optionalString(body.orderNumber, 'orderNumber', 30);
  if (orderNumber !== undefined) out.orderNumber = orderNumber;
  if (body.orderDate !== undefined) {
    const d = optionalDate(body.orderDate, 'orderDate');
    if (d === null) throw new BadRequestException('Campo "orderDate" no puede ser null.');
    out.orderDate = d;
  }
  if (body.expectedDate !== undefined)
    out.expectedDate = optionalDate(body.expectedDate, 'expectedDate');
  const currencyCode = optionalCurrencyCode(body.currencyCode, 'currencyCode');
  if (currencyCode !== undefined) out.currencyCode = currencyCode;
  if (body.exchangeRate !== undefined) {
    out.exchangeRate = positiveRateDecimal(body.exchangeRate, 'exchangeRate');
  }
  if (body.notes !== undefined) out.notes = nullableString(body.notes, 'notes', 300);
  if (body.lines !== undefined) out.lines = parseLinesArray(body.lines, true);
  if (Object.keys(out).length === 0) {
    throw new BadRequestException('No se recibió ningún campo a actualizar.');
  }
  return out;
}

export interface ListPurchaseOrdersQuery {
  status?: string;
  supplierId?: string;
  from?: string;
  to?: string;
}

export interface ParsedListPurchaseOrdersQuery {
  status: PoStatus | null;
  supplierId: bigint | null;
  from: Date | null;
  to: Date | null;
}

export function parseListPurchaseOrdersQuery(
  q: ListPurchaseOrdersQuery,
): ParsedListPurchaseOrdersQuery {
  let status: PoStatus | null = null;
  if (q.status !== undefined && q.status !== '') {
    if (!PO_STATUSES.includes(q.status as PoStatus)) {
      throw new BadRequestException(
        `Parámetro "status" debe ser uno de: ${PO_STATUSES.join(', ')}.`,
      );
    }
    status = q.status as PoStatus;
  }
  return {
    status,
    supplierId: q.supplierId ? requireBigInt(q.supplierId, 'supplierId') : null,
    from: optionalDate(q.from, 'from'),
    to: optionalDate(q.to, 'to'),
  };
}
