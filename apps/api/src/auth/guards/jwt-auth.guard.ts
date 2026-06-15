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
    this.ctx.set({ userId: BigInt(payload.sub), companyId: BigInt(payload.companyId) });
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
