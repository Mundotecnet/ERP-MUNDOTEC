import { RequestContextService } from './request-context.service';

describe('RequestContextService', () => {
  let ctx: RequestContextService;

  beforeEach(() => {
    ctx = new RequestContextService();
  });

  it('devuelve undefined sin scope activo', () => {
    expect(ctx.get()).toBeUndefined();
    expect(ctx.getUserId()).toBeNull();
    expect(ctx.getCompanyId()).toBeNull();
  });

  it('aísla valores por scope', () => {
    const inner = ctx.run({ userId: 1n, companyId: 10n }, () => ({
      uid: ctx.getUserId(),
      cid: ctx.getCompanyId(),
    }));
    expect(inner).toEqual({ uid: 1n, cid: 10n });
    expect(ctx.getUserId()).toBeNull(); // fuera del scope
  });

  it('respeta scopes anidados', () => {
    const result = ctx.run({ userId: 1n, companyId: 10n }, () =>
      ctx.run({ userId: 2n, companyId: 20n }, () => ctx.getUserId()),
    );
    expect(result).toBe(2n);
  });
});
