import { BadRequestException } from '@nestjs/common';

export const PARTNER_TYPES = ['CUSTOMER', 'SUPPLIER', 'BOTH'] as const;
export type PartnerType = (typeof PARTNER_TYPES)[number];

/** Filtro válido para el query `?type=`. Acepta también `BOTH` exacto. */
export const PARTNER_TYPE_FILTERS = ['CUSTOMER', 'SUPPLIER', 'BOTH'] as const;
export type PartnerTypeFilter = (typeof PARTNER_TYPE_FILTERS)[number];

export interface ListPartnersQuery {
  type?: string;
  q?: string;
}

export interface ParsedListPartnersQuery {
  type: PartnerTypeFilter | null;
  q: string | null;
}

export function parseListPartnersQuery(q: ListPartnersQuery): ParsedListPartnersQuery {
  let type: PartnerTypeFilter | null = null;
  if (q.type !== undefined && q.type !== '') {
    if (!PARTNER_TYPE_FILTERS.includes(q.type as PartnerTypeFilter)) {
      throw new BadRequestException(
        `Parámetro "type" debe ser uno de: ${PARTNER_TYPE_FILTERS.join(', ')}.`,
      );
    }
    type = q.type as PartnerTypeFilter;
  }
  const query = typeof q.q === 'string' && q.q.trim().length > 0 ? q.q.trim() : null;
  return { type, q: query };
}

export interface CreatePartnerBody {
  partnerType?: unknown;
  code?: unknown;
  legalName?: unknown;
  tradeName?: unknown;
  taxId?: unknown;
  email?: unknown;
  phone?: unknown;
  address?: unknown;
  currencyCode?: unknown;
  creditLimit?: unknown;
  creditDays?: unknown;
  isActive?: unknown;
  customerCategoryId?: unknown;
}

export interface ParsedCreatePartner {
  partnerType: PartnerType;
  code: string | null;
  legalName: string;
  tradeName: string | null;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  currencyCode: string;
  creditLimit: string;
  creditDays: number;
  isActive: boolean;
  customerCategoryId: bigint | null;
}

export type UpdatePartnerBody = CreatePartnerBody;

export interface ParsedUpdatePartner {
  partnerType?: PartnerType;
  code?: string | null;
  legalName?: string;
  tradeName?: string | null;
  taxId?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  currencyCode?: string;
  creditLimit?: string;
  creditDays?: number;
  isActive?: boolean;
  customerCategoryId?: bigint | null;
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

function asPartnerType(value: unknown): PartnerType {
  if (typeof value !== 'string' || !PARTNER_TYPES.includes(value as PartnerType)) {
    throw new BadRequestException(
      `Campo "partnerType" debe ser uno de: ${PARTNER_TYPES.join(', ')}.`,
    );
  }
  return value as PartnerType;
}

function optionalPartnerType(value: unknown): PartnerType | undefined {
  if (value === undefined) return undefined;
  return asPartnerType(value);
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

function optionalDecimal(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  return nonNegativeDecimal(value, name);
}

function asNonNegativeInt(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new BadRequestException(`Campo "${name}" debe ser un entero >= 0.`);
  }
  return value;
}

function optionalNonNegativeInt(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  return asNonNegativeInt(value, name);
}

function nullableBigInt(value: unknown, name: string): bigint | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new BadRequestException(`Campo "${name}" debe ser string, number o null.`);
  }
  try {
    return BigInt(value);
  } catch {
    throw new BadRequestException(`Campo "${name}" no es un número válido.`);
  }
}

export function parseCreatePartnerBody(body: CreatePartnerBody): ParsedCreatePartner {
  return {
    partnerType: asPartnerType(body.partnerType),
    code: nullableString(body.code, 'code', 30),
    legalName: requireString(body.legalName, 'legalName', 200),
    tradeName: nullableString(body.tradeName, 'tradeName', 200),
    taxId: nullableString(body.taxId, 'taxId', 50),
    email: nullableString(body.email, 'email', 150),
    phone: nullableString(body.phone, 'phone', 50),
    address: nullableString(body.address, 'address', 300),
    currencyCode:
      body.currencyCode === undefined ? 'USD' : asCurrencyCode(body.currencyCode, 'currencyCode'),
    creditLimit:
      body.creditLimit === undefined ? '0' : nonNegativeDecimal(body.creditLimit, 'creditLimit'),
    creditDays: body.creditDays === undefined ? 0 : asNonNegativeInt(body.creditDays, 'creditDays'),
    isActive: body.isActive === undefined ? true : asBoolean(body.isActive, 'isActive'),
    customerCategoryId: nullableBigInt(body.customerCategoryId, 'customerCategoryId'),
  };
}

export function parseUpdatePartnerBody(body: UpdatePartnerBody): ParsedUpdatePartner {
  const out: ParsedUpdatePartner = {};
  const partnerType = optionalPartnerType(body.partnerType);
  if (partnerType !== undefined) out.partnerType = partnerType;
  if (body.code !== undefined) out.code = nullableString(body.code, 'code', 30);
  const legalName = optionalString(body.legalName, 'legalName', 200);
  if (legalName !== undefined) out.legalName = legalName;
  if (body.tradeName !== undefined)
    out.tradeName = nullableString(body.tradeName, 'tradeName', 200);
  if (body.taxId !== undefined) out.taxId = nullableString(body.taxId, 'taxId', 50);
  if (body.email !== undefined) out.email = nullableString(body.email, 'email', 150);
  if (body.phone !== undefined) out.phone = nullableString(body.phone, 'phone', 50);
  if (body.address !== undefined) out.address = nullableString(body.address, 'address', 300);
  const currencyCode = optionalCurrencyCode(body.currencyCode, 'currencyCode');
  if (currencyCode !== undefined) out.currencyCode = currencyCode;
  const creditLimit = optionalDecimal(body.creditLimit, 'creditLimit');
  if (creditLimit !== undefined) out.creditLimit = creditLimit;
  const creditDays = optionalNonNegativeInt(body.creditDays, 'creditDays');
  if (creditDays !== undefined) out.creditDays = creditDays;
  const isActive = optionalBoolean(body.isActive, 'isActive');
  if (isActive !== undefined) out.isActive = isActive;
  if (body.customerCategoryId !== undefined) {
    out.customerCategoryId = nullableBigInt(body.customerCategoryId, 'customerCategoryId');
  }
  if (Object.keys(out).length === 0) {
    throw new BadRequestException('No se recibió ningún campo a actualizar.');
  }
  return out;
}

export interface PartnerContactBody {
  name?: unknown;
  position?: unknown;
  email?: unknown;
  phone?: unknown;
}

export interface ParsedCreateContact {
  name: string;
  position: string | null;
  email: string | null;
  phone: string | null;
}

export interface ParsedUpdateContact {
  name?: string;
  position?: string | null;
  email?: string | null;
  phone?: string | null;
}

export function parseCreateContactBody(body: PartnerContactBody): ParsedCreateContact {
  return {
    name: requireString(body.name, 'name', 150),
    position: nullableString(body.position, 'position', 100),
    email: nullableString(body.email, 'email', 150),
    phone: nullableString(body.phone, 'phone', 50),
  };
}

export function parseUpdateContactBody(body: PartnerContactBody): ParsedUpdateContact {
  const out: ParsedUpdateContact = {};
  const name = optionalString(body.name, 'name', 150);
  if (name !== undefined) out.name = name;
  if (body.position !== undefined) out.position = nullableString(body.position, 'position', 100);
  if (body.email !== undefined) out.email = nullableString(body.email, 'email', 150);
  if (body.phone !== undefined) out.phone = nullableString(body.phone, 'phone', 50);
  if (Object.keys(out).length === 0) {
    throw new BadRequestException('No se recibió ningún campo a actualizar.');
  }
  return out;
}
