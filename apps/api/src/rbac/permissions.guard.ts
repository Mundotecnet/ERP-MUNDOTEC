import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { PrismaService } from '../prisma/prisma.service';
import { RequestContextService } from '../request-context/request-context.service';
import { PERMISSION_METADATA_KEY } from './require-permission.decorator';

/**
 * Guard que verifica que el usuario activo (RequestContext.userId) tenga el
 * permiso declarado con {@link RequirePermission} sobre la ruta.
 *
 * - Si la ruta no declara permiso, deja pasar.
 * - Si no hay `userId` en el contexto, lanza 401.
 * - Si el permiso no aparece entre los del usuario, lanza 403.
 *
 * Sprint 1 stub: el `userId` viene del header `x-user-id` vía
 * RequestContextMiddleware. En Sprint 2 (HU-2.x) se reemplaza por extracción
 * del JWT; el guard no cambia.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly ctx: RequestContextService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string | undefined>(PERMISSION_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const userId = this.ctx.getUserId();
    if (userId === null) {
      throw new UnauthorizedException('Falta identificación de usuario.');
    }

    const has = await this.prisma.raw.permission.findFirst({
      where: {
        code: required,
        rolePermissions: {
          some: {
            role: {
              userRoles: { some: { userId } },
            },
          },
        },
      },
      select: { id: true },
    });

    if (!has) {
      throw new ForbiddenException(`Falta el permiso "${required}".`);
    }
    return true;
  }
}
