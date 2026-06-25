import { BadRequestException } from '@nestjs/common';

export interface CreateUserBody {
  username?: unknown;
  email?: unknown;
  password?: unknown;
  fullName?: unknown;
  isActive?: unknown;
  isSalesperson?: unknown;
  commissionPct?: unknown;
}

export interface ParsedCreateUser {
  username: string;
  email: string;
  password: string;
  fullName: string;
  isActive: boolean;
  isSalesperson: boolean;
  commissionPct: string;
}

export interface UpdateUserBody {
  username?: unknown;
  email?: unknown;
  password?: unknown;
  fullName?: unknown;
  isActive?: unknown;
  isSalesperson?: unknown;
  commissionPct?: unknown;
}

export interface ParsedUpdateUser {
  username?: string;
  email?: string;
  password?: string;
  fullName?: string;
  isActive?: boolean;
  isSalesperson?: boolean;
  commissionPct?: string;
}

export interface ListUsersQuery {
  page?: unknown;
  pageSize?: unknown;
  isSalesperson?: unknown;
  isActive?: unknown;
}

export interface ParsedListUsers {
  page: number;
  pageSize: number;
  isSalesperson?: boolean;
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

function requireEmail(value: unknown, name: string): string {
  const s = requireString(value, name, 150);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) {
    throw new BadRequestException(`Campo "${name}" no parece un correo válido.`);
  }
  return s;
}

function optionalEmail(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  return requireEmail(value, name);
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

/**
 * Devuelve la commisión como string con 4 decimales (Prisma `Decimal` lo acepta).
 * Acepta number en [0, 1] (ej. 0.05 = 5%) o string interpretable como número.
 */
function asCommissionPct(value: unknown, name: string): string {
  let n: number;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && value.trim().length > 0) n = Number(value);
  else throw new BadRequestException(`Campo "${name}" debe ser numérico.`);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new BadRequestException(`Campo "${name}" debe estar entre 0 y 1 (porcentaje).`);
  }
  return n.toFixed(4);
}

function optionalCommissionPct(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  return asCommissionPct(value, name);
}

export function parseCreateUserBody(body: CreateUserBody): ParsedCreateUser {
  return {
    username: requireString(body.username, 'username', 80),
    email: requireEmail(body.email, 'email'),
    password: requireString(body.password, 'password', 200),
    fullName: requireString(body.fullName, 'fullName', 150),
    isActive: body.isActive === undefined ? true : asBoolean(body.isActive, 'isActive'),
    isSalesperson:
      body.isSalesperson === undefined ? false : asBoolean(body.isSalesperson, 'isSalesperson'),
    commissionPct:
      body.commissionPct === undefined
        ? '0.0000'
        : asCommissionPct(body.commissionPct, 'commissionPct'),
  };
}

export function parseUpdateUserBody(body: UpdateUserBody): ParsedUpdateUser {
  const out: ParsedUpdateUser = {};
  const username = optionalString(body.username, 'username', 80);
  if (username !== undefined) out.username = username;
  const email = optionalEmail(body.email, 'email');
  if (email !== undefined) out.email = email;
  const password = optionalString(body.password, 'password', 200);
  if (password !== undefined) out.password = password;
  const fullName = optionalString(body.fullName, 'fullName', 150);
  if (fullName !== undefined) out.fullName = fullName;
  const isActive = optionalBoolean(body.isActive, 'isActive');
  if (isActive !== undefined) out.isActive = isActive;
  const isSalesperson = optionalBoolean(body.isSalesperson, 'isSalesperson');
  if (isSalesperson !== undefined) out.isSalesperson = isSalesperson;
  const commissionPct = optionalCommissionPct(body.commissionPct, 'commissionPct');
  if (commissionPct !== undefined) out.commissionPct = commissionPct;
  if (Object.keys(out).length === 0) {
    throw new BadRequestException('No se recibió ningún campo a actualizar.');
  }
  return out;
}

export function parseListUsersQuery(q: ListUsersQuery): ParsedListUsers {
  function intInRange(raw: unknown, name: string, def: number, max: number): number {
    if (raw === undefined) return def;
    const s = typeof raw === 'string' ? raw : String(raw);
    const n = Number(s);
    if (!Number.isInteger(n) || n < 1 || n > max) {
      throw new BadRequestException(`Parámetro "${name}" debe ser entero entre 1 y ${max}.`);
    }
    return n;
  }
  function flagFromQuery(raw: unknown, name: string): boolean | undefined {
    if (raw === undefined) return undefined;
    if (typeof raw === 'boolean') return raw;
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
    throw new BadRequestException(`Parámetro "${name}" debe ser true/false.`);
  }
  const out: ParsedListUsers = {
    page: intInRange(q.page, 'page', 1, 100_000),
    pageSize: intInRange(q.pageSize, 'pageSize', 20, 200),
  };
  const isSalesperson = flagFromQuery(q.isSalesperson, 'isSalesperson');
  if (isSalesperson !== undefined) out.isSalesperson = isSalesperson;
  const isActive = flagFromQuery(q.isActive, 'isActive');
  if (isActive !== undefined) out.isActive = isActive;
  return out;
}

export interface ReplaceUserRolesBody {
  roleIds?: unknown;
}

export function parseReplaceUserRoles(body: ReplaceUserRolesBody): bigint[] {
  if (!Array.isArray(body.roleIds)) {
    throw new BadRequestException('Campo "roleIds" debe ser un arreglo.');
  }
  const ids: bigint[] = [];
  for (const item of body.roleIds) {
    if (typeof item !== 'string' && typeof item !== 'number') {
      throw new BadRequestException('Cada roleId debe ser string o number.');
    }
    try {
      ids.push(BigInt(item));
    } catch {
      throw new BadRequestException(`roleId inválido: ${String(item)}`);
    }
  }
  // Deduplicar manteniendo el orden de la primera aparición.
  const seen = new Set<string>();
  const out: bigint[] = [];
  for (const id of ids) {
    const key = id.toString();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(id);
    }
  }
  return out;
}
