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

export interface ChangePasswordBody {
  currentPassword?: unknown;
  newPassword?: unknown;
}

export interface ParsedChangePassword {
  currentPassword: string;
  newPassword: string;
}

export function parseChangePasswordBody(body: ChangePasswordBody): ParsedChangePassword {
  if (typeof body.currentPassword !== 'string' || body.currentPassword.length === 0) {
    throw new BadRequestException('Campo "currentPassword" requerido.');
  }
  if (typeof body.newPassword !== 'string' || body.newPassword.length === 0) {
    throw new BadRequestException('Campo "newPassword" requerido.');
  }
  return { currentPassword: body.currentPassword, newPassword: body.newPassword };
}

export interface ForgotPasswordBody {
  username?: unknown;
  email?: unknown;
  companyId?: unknown;
}

export interface ParsedForgotPassword {
  usernameOrEmail: string;
  companyId: bigint | null;
}

export function parseForgotPasswordBody(body: ForgotPasswordBody): ParsedForgotPassword {
  const raw =
    typeof body.email === 'string' && body.email.length > 0
      ? body.email
      : typeof body.username === 'string' && body.username.length > 0
        ? body.username
        : null;
  if (raw === null) {
    throw new BadRequestException('Debes enviar "username" o "email".');
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
  return { usernameOrEmail: raw, companyId };
}

export interface ResetPasswordBody {
  token?: unknown;
  newPassword?: unknown;
}

export interface ParsedResetPassword {
  token: string;
  newPassword: string;
}

export function parseResetPasswordBody(body: ResetPasswordBody): ParsedResetPassword {
  if (typeof body.token !== 'string' || body.token.length === 0) {
    throw new BadRequestException('Campo "token" requerido.');
  }
  if (typeof body.newPassword !== 'string' || body.newPassword.length === 0) {
    throw new BadRequestException('Campo "newPassword" requerido.');
  }
  return { token: body.token, newPassword: body.newPassword };
}
