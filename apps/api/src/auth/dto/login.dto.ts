import { BadRequestException } from '@nestjs/common';

export interface LoginRequestBody {
  username?: unknown;
  password?: unknown;
  companyId?: unknown;
}

export interface ParsedLoginInput {
  username: string;
  password: string;
  /** Si el usuario tiene cuentas en varias empresas, especifica cuál. */
  companyId: bigint | null;
}

export function parseLoginBody(body: LoginRequestBody): ParsedLoginInput {
  if (typeof body.username !== 'string' || body.username.length === 0) {
    throw new BadRequestException('Campo "username" requerido.');
  }
  if (typeof body.password !== 'string' || body.password.length === 0) {
    throw new BadRequestException('Campo "password" requerido.');
  }
  let companyId: bigint | null = null;
  if (body.companyId !== undefined && body.companyId !== null) {
    if (typeof body.companyId !== 'string' && typeof body.companyId !== 'number') {
      throw new BadRequestException('Campo "companyId" debe ser numérico.');
    }
    try {
      companyId = BigInt(body.companyId);
    } catch {
      throw new BadRequestException('Campo "companyId" no es un número válido.');
    }
  }
  return { username: body.username, password: body.password, companyId };
}

export interface RefreshRequestBody {
  refreshToken?: unknown;
}

export function parseRefreshBody(body: RefreshRequestBody): string {
  if (typeof body.refreshToken !== 'string' || body.refreshToken.length === 0) {
    throw new BadRequestException('Campo "refreshToken" requerido.');
  }
  return body.refreshToken;
}
