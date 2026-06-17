import { Controller, Get, UseGuards } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermission } from '../rbac/require-permission.decorator';

interface PermissionView {
  id: string;
  code: string;
  module: string;
  description: string | null;
}

/**
 * Catálogo de permisos del sistema. Es **solo lectura** — nuevos códigos entran
 * vía seed/migración, no por API.
 */
@Controller('permissions')
@UseGuards(PermissionsGuard)
export class PermissionsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('permissions.read')
  async list(): Promise<PermissionView[]> {
    const rows = await this.prisma.raw.permission.findMany({
      orderBy: [{ module: 'asc' }, { code: 'asc' }],
    });
    return rows.map((p) => ({
      id: p.id.toString(),
      code: p.code,
      module: p.module,
      description: p.description,
    }));
  }
}
