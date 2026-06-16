import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { RequestContextService } from '../../request-context/request-context.service';
import { AuthService } from '../auth.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Guard global: requiere Bearer access token y rellena el RequestContext con
 * `{ userId, companyId }` extraídos del payload. Las rutas marcadas con
 * `@Public()` quedan exentas.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly ctx: RequestContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractBearer(request);
    if (!token) {
      throw new UnauthorizedException('Falta encabezado Authorization: Bearer.');
    }

    const payload = await this.auth.verifyAccessToken(token);
    const userId = BigInt(payload.sub);
    const companyId = BigInt(payload.companyId);
    // (1) En el request, para que los controladores lo lean vía @Req() sin
    //     depender de AsyncLocalStorage entre guard → handler (que en Nest 10
    //     no siempre propaga el contexto entrante del enterWith del guard al
    //     handler asíncrono — observado en tests con tokens de distintos
    //     usuarios en el mismo proceso).
    (request as Request & { authUser?: { userId: bigint; companyId: bigint } }).authUser = {
      userId,
      companyId,
    };
    // (2) En el RequestContextService, para que las extensiones Prisma
    //     (audit / tenant / softDelete) vean el contexto durante las queries
    //     que dispara el handler.
    this.ctx.set({ userId, companyId });
    return true;
  }

  private extractBearer(req: Request): string | null {
    const header = req.headers.authorization;
    if (typeof header !== 'string') return null;
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
    return token.trim();
  }
}
