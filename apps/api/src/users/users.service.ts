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
import {
  ParsedCreateUser,
  ParsedListUsers,
  ParsedReplaceUserBranches,
  ParsedUpdateUser,
} from './dto/users.dto';

const BCRYPT_ROUNDS = 10;
const BRANCH_ACCESS_ALL = 'branch.access_all';

export interface UserView {
  id: string;
  username: string;
  email: string;
  fullName: string;
  isActive: boolean;
  isSalesperson: boolean;
  commissionPct: string;
  defaultBranchId: string | null;
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

export interface UserBranchesView {
  /** Sucursales operables (todas si el user tiene `branch.access_all`). */
  branchIds: string[];
  /** Sucursales explícitamente asignadas vía `user_branch` (para UI). */
  assignedBranchIds: string[];
  defaultBranchId: string | null;
  accessAll: boolean;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordPolicy: PasswordPolicyService,
  ) {}

  async list(companyId: bigint, query: ParsedListUsers): Promise<PaginatedUsers> {
    const skip = (query.page - 1) * query.pageSize;
    const where: Prisma.AppUserWhereInput = { companyId, deletedAt: null };
    if (query.isSalesperson !== undefined) where.isSalesperson = query.isSalesperson;
    if (query.isActive !== undefined) where.isActive = query.isActive;
    const [rows, total] = await Promise.all([
      this.prisma.raw.appUser.findMany({
        where,
        orderBy: { username: 'asc' },
        skip,
        take: query.pageSize,
      }),
      this.prisma.raw.appUser.count({ where }),
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
    if (data.defaultBranchId !== null) {
      await this.assertBranchInCompany(companyId, data.defaultBranchId);
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
          defaultBranchId: data.defaultBranchId,
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
    if (data.defaultBranchId !== undefined) {
      if (data.defaultBranchId !== null) {
        await this.assertBranchInCompany(companyId, data.defaultBranchId);
        await this.assertBranchAllowed(existing.id, companyId, data.defaultBranchId);
      }
      updateData.defaultBranch =
        data.defaultBranchId === null
          ? { disconnect: true }
          : { connect: { id: data.defaultBranchId } };
    }

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

  /**
   * Reemplaza el set completo de sucursales asignadas al usuario, y opcionalmente
   * su `defaultBranchId`. Valida:
   *  - Usuario pertenece a la empresa activa.
   *  - Todos los `branchIds` pertenecen a la empresa.
   *  - Si viene `defaultBranchId`, debe estar entre las `branchIds` nuevas o el
   *    usuario debe tener `branch.access_all`.
   *  - Si NO viene `defaultBranchId` y el default vigente queda fuera del
   *    nuevo set (sin access_all), lo pone en NULL automáticamente en la
   *    misma tx (auto-null defensivo).
   *
   * Los usuarios con `branch.access_all` no necesitan filas en `user_branch`
   * — pueden operar todas las sucursales igual. Aún así el endpoint acepta
   * asignaciones (útil si al usuario le quitan el permiso en el futuro).
   */
  async replaceBranches(
    companyId: bigint,
    userId: bigint,
    data: ParsedReplaceUserBranches,
  ): Promise<UserBranchesView> {
    const existing = await this.prisma.raw.appUser.findFirst({
      where: { id: userId, companyId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Usuario no encontrado.');

    if (data.branchIds.length > 0) {
      const found = await this.prisma.raw.branch.findMany({
        where: { id: { in: data.branchIds }, companyId },
        select: { id: true },
      });
      if (found.length !== data.branchIds.length) {
        const ok = new Set(found.map((b) => b.id.toString()));
        const missing = data.branchIds.filter((b) => !ok.has(b.toString()));
        throw new BadRequestException(
          `Sucursales inexistentes o de otra empresa: ${missing.map((m) => m.toString()).join(', ')}`,
        );
      }
    }

    const accessAll = await this.hasAccessAll(existing.id);

    // Resolver el default final. Reglas:
    //  - Si viene explícito en el body: validar y usarlo.
    //  - Si NO viene y el default vigente queda fuera del nuevo set (y no
    //    tiene access_all): auto-null.
    //  - Si NO viene y el default vigente sigue en el set (o tiene access_all
    //    con default de la misma empresa): mantenerlo.
    const newSet = new Set(data.branchIds.map((b) => b.toString()));
    let finalDefault: bigint | null = existing.defaultBranchId;
    if (data.defaultBranchId !== undefined) {
      if (data.defaultBranchId !== null) {
        await this.assertBranchInCompany(companyId, data.defaultBranchId);
        if (!accessAll && !newSet.has(data.defaultBranchId.toString())) {
          throw new BadRequestException(
            'defaultBranchId debe estar entre las sucursales asignadas (o el usuario debe tener branch.access_all).',
          );
        }
      }
      finalDefault = data.defaultBranchId;
    } else if (
      existing.defaultBranchId !== null &&
      !accessAll &&
      !newSet.has(existing.defaultBranchId.toString())
    ) {
      finalDefault = null;
    }

    await this.prisma.raw.$transaction([
      this.prisma.raw.userBranch.deleteMany({ where: { userId: existing.id } }),
      ...(data.branchIds.length > 0
        ? [
            this.prisma.raw.userBranch.createMany({
              data: data.branchIds.map((branchId) => ({ userId: existing.id, branchId })),
            }),
          ]
        : []),
      this.prisma.raw.appUser.update({
        where: { id: existing.id },
        data: { defaultBranchId: finalDefault, updatedAt: new Date() },
      }),
    ]);

    return this.getBranchesFor(companyId, existing.id);
  }

  /**
   * Devuelve las sucursales operables por el usuario:
   *  - Con `branch.access_all` → todas las sucursales activas y no borradas de
   *    la empresa. `assignedBranchIds` refleja lo que sí tiene en `user_branch`
   *    (puede ser vacío) para que la UI muestre selección explícita si aplica.
   *  - Sin access_all → solo las de `user_branch`.
   */
  async getBranchesFor(companyId: bigint, userId: bigint): Promise<UserBranchesView> {
    const user = await this.prisma.raw.appUser.findFirst({
      where: { id: userId, companyId, deletedAt: null },
      select: { id: true, defaultBranchId: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado.');

    const accessAll = await this.hasAccessAll(user.id);

    const assigned = await this.prisma.raw.userBranch.findMany({
      where: { userId: user.id, branch: { companyId } },
      select: { branchId: true },
    });
    const assignedIds = assigned.map((r) => r.branchId.toString());

    let operableIds: string[];
    if (accessAll) {
      const all = await this.prisma.raw.branch.findMany({
        where: { companyId, isActive: true },
        select: { id: true },
      });
      operableIds = all.map((b) => b.id.toString());
    } else {
      operableIds = assignedIds;
    }

    return {
      branchIds: operableIds,
      assignedBranchIds: assignedIds,
      defaultBranchId: user.defaultBranchId?.toString() ?? null,
      accessAll,
    };
  }

  private async hasAccessAll(userId: bigint): Promise<boolean> {
    const has = await this.prisma.raw.permission.findFirst({
      where: {
        code: BRANCH_ACCESS_ALL,
        rolePermissions: {
          some: { role: { userRoles: { some: { userId } } } },
        },
      },
      select: { id: true },
    });
    return has !== null;
  }

  private async assertBranchInCompany(companyId: bigint, branchId: bigint): Promise<void> {
    const b = await this.prisma.raw.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
    if (!b) {
      throw new BadRequestException(
        `La sucursal ${branchId.toString()} no existe o no pertenece a esta empresa.`,
      );
    }
  }

  /**
   * Valida que la sucursal esté entre las permitidas del usuario, considerando
   * `branch.access_all`. Se usa en PATCH /users/:id cuando el body cambia el
   * default de un usuario ya existente sin tocar el set de sucursales.
   */
  private async assertBranchAllowed(
    userId: bigint,
    companyId: bigint,
    branchId: bigint,
  ): Promise<void> {
    if (await this.hasAccessAll(userId)) return;
    const row = await this.prisma.raw.userBranch.findFirst({
      where: { userId, branchId, branch: { companyId } },
      select: { branchId: true },
    });
    if (!row) {
      throw new BadRequestException(
        'defaultBranchId debe estar entre las sucursales asignadas al usuario (o requiere branch.access_all).',
      );
    }
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
    defaultBranchId: bigint | null;
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
      defaultBranchId: row.defaultBranchId?.toString() ?? null,
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
