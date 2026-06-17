import { BadRequestException } from '@nestjs/common';

export interface CreateRoleBody {
  name?: unknown;
  description?: unknown;
}

export interface ParsedCreateRole {
  name: string;
  description: string | null;
}

export interface UpdateRoleBody {
  name?: unknown;
  description?: unknown;
}

export interface ParsedUpdateRole {
  name?: string;
  description?: string | null;
}

export interface ReplaceRolePermissionsBody {
  permissionCodes?: unknown;
}

export interface ListRolesQuery {
  page?: unknown;
  pageSize?: unknown;
}

export interface ParsedListRoles {
  page: number;
  pageSize: number;
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

function nullableString(value: unknown, name: string, max: number): string | null {
  if (value === null || value === '') return null;
  return requireString(value, name, max);
}

export function parseCreateRoleBody(body: CreateRoleBody): ParsedCreateRole {
  return {
    name: requireString(body.name, 'name', 80),
    description:
      body.description === undefined ? null : nullableString(body.description, 'description', 250),
  };
}

export function parseUpdateRoleBody(body: UpdateRoleBody): ParsedUpdateRole {
  const out: ParsedUpdateRole = {};
  const name = optionalString(body.name, 'name', 80);
  if (name !== undefined) out.name = name;
  if (body.description !== undefined) {
    out.description = nullableString(body.description, 'description', 250);
  }
  if (Object.keys(out).length === 0) {
    throw new BadRequestException('No se recibió ningún campo a actualizar.');
  }
  return out;
}

export function parseReplaceRolePermissions(body: ReplaceRolePermissionsBody): string[] {
  if (!Array.isArray(body.permissionCodes)) {
    throw new BadRequestException('Campo "permissionCodes" debe ser un arreglo de strings.');
  }
  const codes: string[] = [];
  for (const item of body.permissionCodes) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      throw new BadRequestException('Cada permissionCode debe ser un texto no vacío.');
    }
    codes.push(item.trim());
  }
  // Eliminamos duplicados manteniendo el orden de la primera aparición.
  return Array.from(new Set(codes));
}

export function parseListRolesQuery(q: ListRolesQuery): ParsedListRoles {
  function intInRange(raw: unknown, name: string, def: number, max: number): number {
    if (raw === undefined) return def;
    const s = typeof raw === 'string' ? raw : String(raw);
    const n = Number(s);
    if (!Number.isInteger(n) || n < 1 || n > max) {
      throw new BadRequestException(`Parámetro "${name}" debe ser entero entre 1 y ${max}.`);
    }
    return n;
  }
  return {
    page: intInRange(q.page, 'page', 1, 100_000),
    pageSize: intInRange(q.pageSize, 'pageSize', 20, 200),
  };
}
