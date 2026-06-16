import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface AuthUserContext {
  userId: bigint;
  companyId: bigint;
}

/**
 * Inyecta `{ userId, companyId }` del access token verificado por el
 * `JwtAuthGuard`. Lee desde `request.authUser` (no del `RequestContextService`)
 * para evitar el escenario donde el contexto del guard no se propaga al
 * handler en algunas combinaciones de Nest + async_hooks.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUserContext => {
    const req = ctx.switchToHttp().getRequest<Request & { authUser?: AuthUserContext }>();
    if (!req.authUser) {
      throw new Error('CurrentUser usado fuera de una ruta protegida por JwtAuthGuard.');
    }
    return req.authUser;
  },
);
