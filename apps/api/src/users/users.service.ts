import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { PasswordPolicyService } from '../auth/password-policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { ParsedCreateUser, ParsedListUsers, ParsedUpdateUser } from './dto/users.dto';

const BCRYPT_ROUNDS = 10;

export interface UserView {
  id: string;
  username: string;
  email: string;
  fullName: string;
  isActive: boolean;
  isSalesperson: boolean;
  commissionPct: string;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedUsers {
  data: UserView[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordPolicy: PasswordPolicyService,
  ) {}

  async list(companyId: bigint, query: ParsedListUsers): Promise<PaginatedUsers> {
    const skip = (query.page - 1) * query.pageSize;
    const [rows, total] = await Promise.all([
      this.prisma.raw.appUser.findMany({
        where: { companyId, deletedAt: null },
        orderBy: { username: 'asc' },
        skip,
        take: query.pageSize,
      }),
      this.prisma.raw.appUser.count({ where: { companyId, deletedAt: null } }),
    ]);
    return {
      data: rows.map((r) => this.toView(r)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async getOne(companyId: bigint, id: bigint): Promise<UserView> {
    const row = await this.prisma.raw.appUser.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Usuario no encontrado.');
    return this.toView(row);
  }

  async create(companyId: bigint, data: ParsedCreateUser): Promise<UserView> {
    const validation = await this.passwordPolicy.validateForCompany(companyId, data.password);
    if (!validation.ok) {
      throw new BadRequestException({
        message: 'La contraseña no cumple la política de la empresa.',
        errors: validation.errors,
      });
    }
    try {
      const row = await this.prisma.client.appUser.create({
        data: {
          companyId,
          username: data.username,
          email: data.email,
          passwordHash: await bcrypt.hash(data.password, BCRYPT_ROUNDS),
          fullName: data.fullName,
          isActive: data.isActive,
          isSalesperson: data.isSalesperson,
          commissionPct: data.commissionPct,
        },
      });
      return this.toView(row);
    } catch (err) {
      this.translateUniqueViolation(err);
      throw err;
    }
  }

  async update(companyId: bigint, id: bigint, data: ParsedUpdateUser): Promise<UserView> {
    const existing = await this.prisma.raw.appUser.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Usuario no encontrado.');

    const updateData: Prisma.AppUserUpdateInput = { updatedAt: new Date() };
    if (data.username !== undefined) updateData.username = data.username;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.fullName !== undefined) updateData.fullName = data.fullName;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.isSalesperson !== undefined) updateData.isSalesperson = data.isSalesperson;
    if (data.commissionPct !== undefined) updateData.commissionPct = data.commissionPct;

    let revokeRefresh = false;
    if (data.password !== undefined) {
      const validation = await this.passwordPolicy.validateForCompany(companyId, data.password);
      if (!validation.ok) {
        throw new BadRequestException({
          message: 'La contraseña no cumple la política de la empresa.',
          errors: validation.errors,
        });
      }
      updateData.passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
      // Reseteamos el bloqueo cuando el admin cambia la password manualmente.
      updateData.failedLoginAttempts = 0;
      updateData.lockedUntil = null;
      revokeRefresh = true;
    }

    try {
      const row = await this.prisma.client.appUser.update({
        where: { id: existing.id },
        data: updateData,
      });
      if (revokeRefresh) {
        await this.prisma.raw.refreshToken.updateMany({
          where: { userId: existing.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return this.toView(row);
    } catch (err) {
      this.translateUniqueViolation(err);
      throw err;
    }
  }

  async remove(companyId: bigint, id: bigint): Promise<void> {
    const existing = await this.prisma.raw.appUser.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Usuario no encontrado.');

    // La extensión `softDelete` convierte el delete en `update deletedAt = now()`
    // y escribe el audit con action=DELETE; usar prisma.client garantiza la cadena.
    await this.prisma.client.appUser.delete({ where: { id: existing.id } });
    await this.prisma.raw.refreshToken.updateMany({
      where: { userId: existing.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Reemplaza el set completo de roles del usuario. Valida que el user sea de
   * la empresa activa y que TODOS los roleIds existan en la misma empresa (no
   * se pueden asignar roles de otra empresa).
   *
   * Efecto inmediato: como `PermissionsGuard` consulta la DB en cada request,
   * el siguiente endpoint que el user llame ya refleja el cambio.
   */
  async replaceRoles(companyId: bigint, userId: bigint, roleIds: bigint[]): Promise<UserView> {
    const existing = await this.prisma.raw.appUser.findFirst({
      where: { id: userId, companyId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Usuario no encontrado.');

    if (roleIds.length === 0) {
      await this.prisma.raw.userRole.deleteMany({ where: { userId: existing.id } });
      return this.toView(existing);
    }

    const found = await this.prisma.raw.role.findMany({
      where: { id: { in: roleIds }, companyId },
      select: { id: true },
    });
    if (found.length !== roleIds.length) {
      const foundIds = new Set(found.map((r) => r.id.toString()));
      const missing = roleIds.filter((r) => !foundIds.has(r.toString()));
      throw new BadRequestException(
        `Roles inexistentes o de otra empresa: ${missing.map((m) => m.toString()).join(', ')}`,
      );
    }

    await this.prisma.raw.$transaction([
      this.prisma.raw.userRole.deleteMany({ where: { userId: existing.id } }),
      this.prisma.raw.userRole.createMany({
        data: found.map((r) => ({ userId: existing.id, roleId: r.id })),
      }),
    ]);
    return this.toView(existing);
  }

  private translateUniqueViolation(err: unknown): void {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = Array.isArray(err.meta?.target)
        ? err.meta?.target.join(', ')
        : err.meta?.target;
      throw new ConflictException(
        `Ya existe un usuario con ese valor único (${target ?? 'username o email'}).`,
      );
    }
  }

  private toView(row: {
    id: bigint;
    username: string;
    email: string;
    fullName: string;
    isActive: boolean;
    isSalesperson: boolean;
    commissionPct: Prisma.Decimal;
    lastLoginAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): UserView {
    return {
      id: row.id.toString(),
      username: row.username,
      email: row.email,
      fullName: row.fullName,
      isActive: row.isActive,
      isSalesperson: row.isSalesperson,
      commissionPct: row.commissionPct.toString(),
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
