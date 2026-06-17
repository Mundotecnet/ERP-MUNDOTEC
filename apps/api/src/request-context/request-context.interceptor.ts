import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';

import { RequestContextService } from './request-context.service';

/**
 * APP_INTERCEPTOR que refresca el `RequestContextService` con el usuario del
 * request justo antes de invocar al handler. Es la red de seguridad para que
 * las extensiones Prisma (`audit`, `tenant`, `softDelete`) vean el contexto
 * cuando se llaman desde el handler/servicio.
 *
 * Por qué: el `JwtAuthGuard` ya hace `ctx.set(...)` con `enterWith`, pero el
 * async chain del guard NO siempre llega al handler en NestJS 10 + Express.
 * El interceptor corre en el mismo async resource que el handler, así que su
 * `enterWith` sí queda vigente durante las queries Prisma del handler.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  constructor(private readonly ctx: RequestContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType<'http' | 'rpc' | 'ws'>() === 'http') {
      const req = context
        .switchToHttp()
        .getRequest<Request & { authUser?: { userId: bigint; companyId: bigint } }>();
      if (req.authUser) {
        this.ctx.set({
          userId: req.authUser.userId,
          companyId: req.authUser.companyId,
        });
      }
    }
    return next.handle();
  }
}
