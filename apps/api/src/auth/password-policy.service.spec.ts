import { DEFAULT_POLICY, PasswordPolicyService } from './password-policy.service';

describe('PasswordPolicyService.validate', () => {
  // Para las reglas no necesitamos Prisma; instanciamos con un mock vacío.
  const svc = new PasswordPolicyService({} as never);

  it('acepta una password que cumple defaults (10+, upper, lower, digit)', () => {
    const r = svc.validate('Abcdefgh1!');
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rechaza una password muy corta', () => {
    const r = svc.validate('Ab1');
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(expect.arrayContaining([expect.stringContaining('al menos 10')]));
  });

  it('exige mayúscula', () => {
    const r = svc.validate('abcdefghi1');
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(expect.arrayContaining([expect.stringContaining('mayúscula')]));
  });

  it('exige minúscula', () => {
    const r = svc.validate('ABCDEFGHI1');
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(expect.arrayContaining([expect.stringContaining('minúscula')]));
  });

  it('exige dígito', () => {
    const r = svc.validate('Abcdefghijk');
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(expect.arrayContaining([expect.stringContaining('dígito')]));
  });

  it('opcionalmente exige especial si la policy lo dice', () => {
    const r = svc.validate('Abcdefgh12', { ...DEFAULT_POLICY, requireSpecial: true });
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(expect.arrayContaining([expect.stringContaining('especial')]));
  });

  it('valida varios errores juntos', () => {
    const r = svc.validate('abc');
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });
});
