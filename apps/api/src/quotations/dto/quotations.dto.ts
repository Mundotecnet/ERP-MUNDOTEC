import { BadRequestException } from '@nestjs/common';

export const QUOTE_STATUSES = [
  'DRAFT',
  'SENT',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'CONVERTED',
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export interface CreateQuoteLineBody {
  productId?: unknown;
  description?: unknown;
  quantity?: unknown;
  unitPrice?: unknown;
  discountRate?: unknown;
  taxRate?: unknown;
}

export interface ParsedCreateQuoteLine {
  productId: bigint | null;
  description: string | null;
  quantity: string;
  unitPrice: string;
  discountRate: string;
  taxRate: string;
}

export interface CreateQuotationBody {
  customerId?: unknown;
  branchId?: unknown;
  salespersonId?: unknown;
  quoteNumber?: unknown;
  quoteDate?: unknown;
  validUntil?: unknown;
  currencyCode?: unknown;
  exchangeRate?: unknown;
  notes?: unknown;
  lines?: unknown;
}

export interface ParsedCreateQuotation {
  customerId: bigint | null;
  branchId: bigint | null;
  salespersonId: bigint | null;
  quoteNumber: string;
  quoteDate: Date | null;
  validUntil: Date | null;
  currencyCode: string;
  exchangeRate: string | null;
  notes: string | null;
  lines: ParsedCreateQuoteLine[];
}

export type UpdateQuotationBody = CreateQuotationBody;

export interface ParsedUpdateQuotation {
  customerId?: bigint | null;
  branchId?: bigint | null;
  salespersonId?: bigint | null;
  quoteNumber?: string;
  quoteDate?: Date;
  validUntil?: Date | null;
  currencyCode?: string;
  exchangeRate?: string;
  notes?: string | null;
  lines?: ParsedCreateQuoteLine[];
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

/** Tasa entre 0 y < 1 (descuento). Cero permitido. */
function rateLessThanOne(value: unknown, name: string): string {
  const s = nonNegativeDecimal(value, name);
  const n = parseFloat(s);
  if (n >= 1) {
    throw new BadRequestException(`Campo "${name}" debe ser < 1 (use fracción decimal).`);
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

function parseLineBody(raw: unknown, idx: number): ParsedCreateQuoteLine {
  if (raw === null || typeof raw !== 'object') {
    throw new BadRequestException(`Línea #${idx + 1} debe ser un objeto.`);
  }
  const r = raw as CreateQuoteLineBody;
  const productId = nullableBigInt(r.productId, `lines[${idx}].productId`);
  const description = nullableString(r.description, `lines[${idx}].description`, 250);
  // Si no hay producto, la descripción es obligatoria (línea libre).
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
    discountRate:
      r.discountRate === undefined
        ? '0'
        : rateLessThanOne(r.discountRate, `lines[${idx}].discountRate`),
    taxRate: r.taxRate === undefined ? '0' : nonNegativeDecimal(r.taxRate, `lines[${idx}].taxRate`),
  };
}

function parseLinesArray(value: unknown, requireNonEmpty: boolean): ParsedCreateQuoteLine[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException('Campo "lines" debe ser un arreglo.');
  }
  if (requireNonEmpty && value.length === 0) {
    throw new BadRequestException('Campo "lines" debe tener al menos una línea.');
  }
  return value.map((raw, idx) => parseLineBody(raw, idx));
}

export function parseCreateQuotationBody(body: CreateQuotationBody): ParsedCreateQuotation {
  return {
    customerId: nullableBigInt(body.customerId, 'customerId'),
    branchId: nullableBigInt(body.branchId, 'branchId'),
    salespersonId: nullableBigInt(body.salespersonId, 'salespersonId'),
    quoteNumber: requireString(body.quoteNumber, 'quoteNumber', 30),
    quoteDate: optionalDate(body.quoteDate, 'quoteDate'),
    validUntil: optionalDate(body.validUntil, 'validUntil'),
    currencyCode:
      body.currencyCode === undefined ? 'USD' : asCurrencyCode(body.currencyCode, 'currencyCode'),
    exchangeRate:
      body.exchangeRate === undefined
        ? null
        : positiveRateDecimal(body.exchangeRate, 'exchangeRate'),
    notes: nullableString(body.notes, 'notes', 300),
    lines: parseLinesArray(body.lines, true),
  };
}

export function parseUpdateQuotationBody(body: UpdateQuotationBody): ParsedUpdateQuotation {
  const out: ParsedUpdateQuotation = {};
  if (body.customerId !== undefined) out.customerId = nullableBigInt(body.customerId, 'customerId');
  if (body.branchId !== undefined) out.branchId = nullableBigInt(body.branchId, 'branchId');
  if (body.salespersonId !== undefined)
    out.salespersonId = nullableBigInt(body.salespersonId, 'salespersonId');
  const quoteNumber = optionalString(body.quoteNumber, 'quoteNumber', 30);
  if (quoteNumber !== undefined) out.quoteNumber = quoteNumber;
  if (body.quoteDate !== undefined) {
    const d = optionalDate(body.quoteDate, 'quoteDate');
    if (d === null) throw new BadRequestException('Campo "quoteDate" no puede ser null.');
    out.quoteDate = d;
  }
  if (body.validUntil !== undefined) out.validUntil = optionalDate(body.validUntil, 'validUntil');
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

export interface ListQuotationsQuery {
  status?: string;
  customerId?: string;
  from?: string;
  to?: string;
}

export interface ParsedListQuotationsQuery {
  status: QuoteStatus | null;
  customerId: bigint | null;
  from: Date | null;
  to: Date | null;
}

export function parseListQuotationsQuery(q: ListQuotationsQuery): ParsedListQuotationsQuery {
  let status: QuoteStatus | null = null;
  if (q.status !== undefined && q.status !== '') {
    if (!QUOTE_STATUSES.includes(q.status as QuoteStatus)) {
      throw new BadRequestException(
        `Parámetro "status" debe ser uno de: ${QUOTE_STATUSES.join(', ')}.`,
      );
    }
    status = q.status as QuoteStatus;
  }
  return {
    status,
    customerId: q.customerId ? requireBigInt(q.customerId, 'customerId') : null,
    from: optionalDate(q.from, 'from'),
    to: optionalDate(q.to, 'to'),
  };
}
