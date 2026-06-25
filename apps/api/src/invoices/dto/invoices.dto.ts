import { BadRequestException } from '@nestjs/common';

export const INVOICE_STATUSES = ['ISSUED', 'PARTIAL', 'PAID', 'CANCELLED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface CreateInvoiceLineBody {
  productId?: unknown;
  description?: unknown;
  quantity?: unknown;
  unitPrice?: unknown;
  taxRate?: unknown;
}

export interface ParsedCreateInvoiceLine {
  productId: bigint | null;
  description: string | null;
  quantity: string;
  unitPrice: string;
  taxRate: string;
}

export interface CreateInvoiceBody {
  customerId?: unknown;
  branchId?: unknown;
  salespersonId?: unknown;
  salesOrderId?: unknown;
  warehouseId?: unknown;
  invoiceNumber?: unknown;
  invoiceDate?: unknown;
  dueDate?: unknown;
  currencyCode?: unknown;
  exchangeRate?: unknown;
  lines?: unknown;
}

export interface ParsedCreateInvoice {
  customerId: bigint;
  branchId: bigint | null;
  salespersonId: bigint | null;
  salesOrderId: bigint | null;
  /** Almacén del que sale el stock; requerido al emitir. */
  warehouseId: bigint;
  invoiceNumber: string;
  invoiceDate: Date | null;
  dueDate: Date | null;
  currencyCode: string;
  exchangeRate: string | null;
  lines: ParsedCreateInvoiceLine[];
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

function parseLineBody(raw: unknown, idx: number): ParsedCreateInvoiceLine {
  if (raw === null || typeof raw !== 'object') {
    throw new BadRequestException(`Línea #${idx + 1} debe ser un objeto.`);
  }
  const r = raw as CreateInvoiceLineBody;
  const productId = nullableBigInt(r.productId, `lines[${idx}].productId`);
  const description = nullableString(r.description, `lines[${idx}].description`, 250);
  if (productId === null && description === null) {
    throw new BadRequestException(
      `Línea #${idx + 1}: requiere "productId" o "description" (al menos uno).`,
    );
  }
  return {
    productId,
    description,
    quantity: positiveDecimal(r.quantity, `lines[${idx}].quantity`),
    unitPrice: nonNegativeDecimal(r.unitPrice, `lines[${idx}].unitPrice`),
    taxRate: r.taxRate === undefined ? '0' : nonNegativeDecimal(r.taxRate, `lines[${idx}].taxRate`),
  };
}

function parseLinesArray(value: unknown): ParsedCreateInvoiceLine[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException('Campo "lines" debe ser un arreglo.');
  }
  if (value.length === 0) {
    throw new BadRequestException('Campo "lines" debe tener al menos una línea.');
  }
  return value.map((raw, idx) => parseLineBody(raw, idx));
}

export function parseCreateInvoiceBody(body: CreateInvoiceBody): ParsedCreateInvoice {
  return {
    customerId: requireBigInt(body.customerId, 'customerId'),
    branchId: nullableBigInt(body.branchId, 'branchId'),
    salespersonId: nullableBigInt(body.salespersonId, 'salespersonId'),
    salesOrderId: nullableBigInt(body.salesOrderId, 'salesOrderId'),
    warehouseId: requireBigInt(body.warehouseId, 'warehouseId'),
    invoiceNumber: requireString(body.invoiceNumber, 'invoiceNumber', 40),
    invoiceDate: optionalDate(body.invoiceDate, 'invoiceDate'),
    dueDate: optionalDate(body.dueDate, 'dueDate'),
    currencyCode:
      body.currencyCode === undefined ? 'USD' : asCurrencyCode(body.currencyCode, 'currencyCode'),
    exchangeRate:
      body.exchangeRate === undefined
        ? null
        : positiveRateDecimal(body.exchangeRate, 'exchangeRate'),
    lines: parseLinesArray(body.lines),
  };
}

export interface ListInvoicesQuery {
  status?: string;
  customerId?: string;
  from?: string;
  to?: string;
}

export interface ParsedListInvoicesQuery {
  status: InvoiceStatus | null;
  customerId: bigint | null;
  from: Date | null;
  to: Date | null;
}

export function parseListInvoicesQuery(q: ListInvoicesQuery): ParsedListInvoicesQuery {
  let status: InvoiceStatus | null = null;
  if (q.status !== undefined && q.status !== '') {
    if (!INVOICE_STATUSES.includes(q.status as InvoiceStatus)) {
      throw new BadRequestException(
        `Parámetro "status" debe ser uno de: ${INVOICE_STATUSES.join(', ')}.`,
      );
    }
    status = q.status as InvoiceStatus;
  }
  return {
    status,
    customerId: q.customerId ? requireBigInt(q.customerId, 'customerId') : null,
    from: optionalDate(q.from, 'from'),
    to: optionalDate(q.to, 'to'),
  };
}
