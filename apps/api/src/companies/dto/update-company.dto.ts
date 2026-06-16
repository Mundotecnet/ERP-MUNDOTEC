import { BadRequestException } from '@nestjs/common';

import { normalizeCostaRicaTaxId } from '../cr-tax-id';

export interface UpdateCompanyBody {
  legalName?: unknown;
  tradeName?: unknown;
  taxId?: unknown;
  currencyCode?: unknown;
  address?: unknown;
  phone?: unknown;
  email?: unknown;
  logoUrl?: unknown;
}

export interface ParsedUpdateCompany {
  legalName?: string;
  tradeName?: string | null;
  taxId?: string;
  currencyCode?: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  logoUrl?: string | null;
}

function asString(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`Campo "${name}" debe ser un texto no vacío.`);
  }
  if (value.length > max) {
    throw new BadRequestException(`Campo "${name}" excede ${max} caracteres.`);
  }
  return value.trim();
}

function asNullableString(value: unknown, name: string, max: number): string | null {
  if (value === null) return null;
  if (value === '') return null;
  return asString(value, name, max);
}

function asEmail(value: unknown, name: string): string | null {
  const trimmed = asNullableString(value, name, 150);
  if (trimmed === null) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
    throw new BadRequestException(`Campo "${name}" no parece un correo válido.`);
  }
  return trimmed;
}

function asCurrencyCode(value: unknown): string {
  const s = asString(value, 'currencyCode', 3);
  if (!/^[A-Z]{3}$/.test(s)) {
    throw new BadRequestException(
      'Campo "currencyCode" debe ser un código ISO-4217 de 3 letras mayúsculas (ej. CRC, USD).',
    );
  }
  return s;
}

export function parseUpdateCompanyBody(body: UpdateCompanyBody): ParsedUpdateCompany {
  const out: ParsedUpdateCompany = {};
  if (body.legalName !== undefined) out.legalName = asString(body.legalName, 'legalName', 200);
  if (body.tradeName !== undefined)
    out.tradeName = asNullableString(body.tradeName, 'tradeName', 200);
  if (body.taxId !== undefined) {
    if (typeof body.taxId !== 'string' || body.taxId.trim().length === 0) {
      throw new BadRequestException('Campo "taxId" debe ser un texto no vacío.');
    }
    try {
      out.taxId = normalizeCostaRicaTaxId(body.taxId);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Identificación tributaria inválida.',
      );
    }
  }
  if (body.currencyCode !== undefined) out.currencyCode = asCurrencyCode(body.currencyCode);
  if (body.address !== undefined) out.address = asNullableString(body.address, 'address', 300);
  if (body.phone !== undefined) out.phone = asNullableString(body.phone, 'phone', 50);
  if (body.email !== undefined) out.email = asEmail(body.email, 'email');
  if (body.logoUrl !== undefined) out.logoUrl = asNullableString(body.logoUrl, 'logoUrl', 300);
  if (Object.keys(out).length === 0) {
    throw new BadRequestException('No se recibió ningún campo a actualizar.');
  }
  return out;
}
