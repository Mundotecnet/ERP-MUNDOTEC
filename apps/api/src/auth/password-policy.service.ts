import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Reglas de la policy. Si la empresa no tiene fila en `password_policy`, se
 * aplican los valores por defecto definidos abajo (10 caracteres + mayúscula
 * + minúscula + dígito; sin caracteres especiales obligatorios).
 */
export interface PasswordPolicy {
  minLength: number;
  requireUpper: boolean;
  requireLower: boolean;
  requireDigit: boolean;
  requireSpecial: boolean;
}

export const DEFAULT_POLICY: PasswordPolicy = {
  minLength: 10,
  requireUpper: true,
  requireLower: true,
  requireDigit: true,
  requireSpecial: false,
};

export interface PasswordValidationResult {
  ok: boolean;
  errors: string[];
}

@Injectable()
export class PasswordPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async getPolicy(companyId: bigint): Promise<PasswordPolicy> {
    const row = await this.prisma.raw.passwordPolicy.findUnique({
      where: { companyId },
    });
    if (!row) return DEFAULT_POLICY;
    return {
      minLength: row.minLength,
      requireUpper: row.requireUpper,
      requireLower: row.requireLower,
      requireDigit: row.requireDigit,
      requireSpecial: row.requireSpecial,
    };
  }

  /** Valida una contraseña en claro contra la policy dada. */
  validate(password: string, policy: PasswordPolicy = DEFAULT_POLICY): PasswordValidationResult {
    const errors: string[] = [];
    if (password.length < policy.minLength) {
      errors.push(`Debe tener al menos ${policy.minLength} caracteres.`);
    }
    if (policy.requireUpper && !/[A-Z]/.test(password)) {
      errors.push('Debe incluir al menos una letra mayúscula.');
    }
    if (policy.requireLower && !/[a-z]/.test(password)) {
      errors.push('Debe incluir al menos una letra minúscula.');
    }
    if (policy.requireDigit && !/\d/.test(password)) {
      errors.push('Debe incluir al menos un dígito.');
    }
    if (policy.requireSpecial && !/[^A-Za-z0-9]/.test(password)) {
      errors.push('Debe incluir al menos un carácter especial.');
    }
    return { ok: errors.length === 0, errors };
  }

  /** Atajo: lee la policy y valida. */
  async validateForCompany(companyId: bigint, password: string): Promise<PasswordValidationResult> {
    const policy = await this.getPolicy(companyId);
    return this.validate(password, policy);
  }
}
