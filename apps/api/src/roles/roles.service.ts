import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ParsedCreateRole, ParsedListRoles, ParsedUpdateRole } from './dto/roles.dto';

export interface RoleView {
  id: string;
  name: string;
  description: string | null;
  permissions: string[]; // permission.code
}

export interface PaginatedRoles {
  data: RoleView[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: bigint, query: ParsedListRoles): Promise<PaginatedRoles> {
    const skip = (query.page - 1) * query.pageSize;
    const [rows, total] = await Promise.all([
      this.prisma.raw.role.findMany({
        where: { companyId },
        include: { rolePermissions: { include: { permission: { select: { code: true } } } } },
        orderBy: { name: 'asc' },
        skip,
        take: query.pageSize,
      }),
      this.prisma.raw.role.count({ where: { companyId } }),
    ]);
    return {
      data: rows.map((r) => this.toView(r)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async getOne(companyId: bigint, id: bigint): Promise<RoleView> {
    const row = await this.prisma.raw.role.findFirst({
      where: { id, companyId },
      include: { rolePermissions: { include: { permission: { select: { code: true } } } } },
    });
    if (!row) throw new NotFoundException('Rol no encontrado.');
    return this.toView(row);
  }

  async create(companyId: bigint, data: ParsedCreateRole): Promise<RoleView> {
    try {
      const row = await this.prisma.client.role.create({
        data: { companyId, name: data.name, description: data.description },
      });
      return this.toView({ ...row, rolePermissions: [] });
    } catch (err) {
      this.translateUniqueViolation(err);
      throw err;
    }
  }

  async update(companyId: bigint, id: bigint, data: ParsedUpdateRole): Promise<RoleView> {
    const existing = await this.prisma.raw.role.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Rol no encontrado.');
    try {
      const row = await this.prisma.client.role.update({
        where: { id: existing.id },
        data,
        include: { rolePermissions: { include: { permission: { select: { code: true } } } } },
      });
      return this.toView(row);
    } catch (err) {
      this.translateUniqueViolation(err);
      throw err;
    }
  }

  async remove(companyId: bigint, id: bigint): Promise<void> {
    const existing = await this.prisma.raw.role.findFirst({
      where: { id, companyId },
      include: { _count: { select: { userRoles: true } } },
    });
    if (!existing) throw new NotFoundException('Rol no encontrado.');
    if (existing._count.userRoles > 0) {
      throw new ConflictException(
        'No se puede eliminar el rol porque está asignado a uno o más usuarios. ' +
          'Quita la asignación primero.',
      );
    }
    // No es un modelo soft-deletable; va por la cadena de extensiones (audit
    // queda en audit_log como DELETE).
    await this.prisma.client.role.delete({ where: { id: existing.id } });
  }

  /**
   * Reemplaza el conjunto completo de permisos de un rol. Valida que todos los
   * códigos existan en `permission`. Es atómico vía $transaction.
   */
  async replacePermissions(
    companyId: bigint,
    id: bigint,
    permissionCodes: string[],
  ): Promise<RoleView> {
    const existing = await this.prisma.raw.role.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Rol no encontrado.');

    if (permissionCodes.length === 0) {
      await this.prisma.raw.rolePermission.deleteMany({ where: { roleId: existing.id } });
      return this.getOne(companyId, id);
    }

    const found = await this.prisma.raw.permission.findMany({
      where: { code: { in: permissionCodes } },
      select: { id: true, code: true },
    });
    if (found.length !== permissionCodes.length) {
      const missing = permissionCodes.filter((c) => !found.some((p) => p.code === c));
      throw new BadRequestException(`Códigos de permiso inexistentes: ${missing.join(', ')}`);
    }

    await this.prisma.raw.$transaction([
      this.prisma.raw.rolePermission.deleteMany({ where: { roleId: existing.id } }),
      this.prisma.raw.rolePermission.createMany({
        data: found.map((p) => ({ roleId: existing.id, permissionId: p.id })),
      }),
    ]);
    return this.getOne(companyId, id);
  }

  private translateUniqueViolation(err: unknown): void {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException('Ya existe un rol con ese nombre en la empresa.');
    }
  }

  private toView(row: {
    id: bigint;
    name: string;
    description: string | null;
    rolePermissions: { permission: { code: string } }[];
  }): RoleView {
    return {
      id: row.id.toString(),
      name: row.name,
      description: row.description,
      permissions: row.rolePermissions.map((rp) => rp.permission.code).sort(),
    };
  }
}
