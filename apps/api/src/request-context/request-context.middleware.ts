import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RequestContextService } from './request-context.service';

/**
 * Abre el `AsyncLocalStorage` por request. En Sprint 1 todavía no hay JWT, así
 * que aceptamos los headers `x-user-id` / `x-company-id` como stub para que el
 * endpoint dummy (PR-4) y los tests de integración puedan establecer contexto.
 * Cuando llegue auth real (Sprint 2 — HU-2.x), el middleware extraerá userId
 * y companyId del payload del JWT en su lugar.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly ctx: RequestContextService) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    const userId = this.parseBigIntHeader(req.headers['x-user-id']);
    const companyId = this.parseBigIntHeader(req.headers['x-company-id']);
    this.ctx.set({ userId, companyId });
    next();
  }

  private parseBigIntHeader(value: string | string[] | undefined): bigint | null {
    if (typeof value !== 'string' || value.length === 0) return null;
    try {
      return BigInt(value);
    } catch {
      return null;
    }
  }
}
