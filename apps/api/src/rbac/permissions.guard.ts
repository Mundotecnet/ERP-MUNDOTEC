import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { PrismaService } from '../prisma/prisma.service';
import { RequestContextService } from '../request-context/request-context.service';
import { PERMISSION_METADATA_KEY } from './require-permission.decorator';

/**
 * Guard que verifica que el usuario activo tenga el permiso declarado con
 * {@link RequirePermission} sobre la ruta.
 *
 * - Si la ruta no declara permiso, deja pasar.
 * - Si no hay `userId` en `request.authUser` (puesto por JwtAuthGuard) ni en
 *   `RequestContextService`, lanza 401.
 * - Si el permiso no aparece entre los del usuario, lanza 403.
 *
 * Lee primero de `request.authUser` y luego del `RequestContextService` como
 * fallback. En el flujo HTTP normal el guard JWT corre antes y rellena ambos,
 * pero `enterWith` no siempre propaga del guard al handler asíncrono — la
 * fuente confiable en HTTP es el request.
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

    const req = context.switchToHttp().getRequest<Request & { authUser?: { userId: bigint } }>();
    const userId = req.authUser?.userId ?? this.ctx.getUserId();
    if (userId === null || userId === undefined) {
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
