import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { PrismaService } from '../prisma/prisma.service';
import { RequestContextService } from '../request-context/request-context.service';
import { PermissionsGuard } from './permissions.guard';

function makeContext(): ExecutionContext {
  return {
    getHandler: () => 'handler',
    getClass: () => 'Class',
    switchToHttp: () => ({ getRequest: () => ({}), getResponse: () => ({}), getNext: () => ({}) }),
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToRpc: () => ({}) as never,
    switchToWs: () => ({}) as never,
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  let reflector: Reflector;
  let ctx: RequestContextService;
  let prisma: { raw: { permission: { findFirst: jest.Mock } } };
  let guard: PermissionsGuard;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn<string | undefined, [string, unknown[]]>(),
    } as unknown as Reflector;
    ctx = new RequestContextService();
    prisma = { raw: { permission: { findFirst: jest.fn() } } };
    guard = new PermissionsGuard(reflector, ctx, prisma as unknown as PrismaService);
  });

  it('deja pasar si la ruta no declara permiso', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);
    await expect(guard.canActivate(makeContext())).resolves.toBe(true);
    expect(prisma.raw.permission.findFirst).not.toHaveBeenCalled();
  });

  it('lanza 401 si la ruta requiere permiso y no hay usuario en contexto', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue('company.update');
    await expect(guard.canActivate(makeContext())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('lanza 403 si el usuario no tiene el permiso', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue('company.update');
    prisma.raw.permission.findFirst.mockResolvedValue(null);
    await ctx.run({ userId: 99n, companyId: null }, async () => {
      await expect(guard.canActivate(makeContext())).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  it('deja pasar si el usuario tiene el permiso', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue('company.update');
    prisma.raw.permission.findFirst.mockResolvedValue({ id: 1n });
    await ctx.run({ userId: 99n, companyId: null }, async () => {
      await expect(guard.canActivate(makeContext())).resolves.toBe(true);
    });
  });
});
