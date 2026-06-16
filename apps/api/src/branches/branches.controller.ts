import { Controller, Get, UseGuards } from '@nestjs/common';

import { AuthUserContext, CurrentUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermission } from '../rbac/require-permission.decorator';

interface BranchView {
  id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
}

/**
 * En Sprint 2 sólo exponemos `GET /branches` para validar el aislamiento por
 * empresa (HU-3.3). El CRUD completo es HU-3.2, Sprint 3.
 */
@Controller('branches')
@UseGuards(PermissionsGuard)
export class BranchesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('branch.read')
  async list(@CurrentUser() user: AuthUserContext): Promise<BranchView[]> {
    // Pasamos companyId explícito al where además de confiar en la extensión
    // tenant — defensa en profundidad.
    const rows = await this.prisma.raw.branch.findMany({
      where: { companyId: user.companyId },
      orderBy: { code: 'asc' },
    });
    return rows.map((b) => ({
      id: b.id.toString(),
      code: b.code,
      name: b.name,
      address: b.address,
      phone: b.phone,
      isActive: b.isActive,
    }));
  }
}
