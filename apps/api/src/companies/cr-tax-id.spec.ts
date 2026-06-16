import { normalizeCostaRicaTaxId } from './cr-tax-id';

describe('normalizeCostaRicaTaxId', () => {
  it('normaliza cédula jurídica con guiones', () => {
    expect(normalizeCostaRicaTaxId('3-101-123456')).toBe('3-101-123456');
  });

  it('normaliza cédula jurídica sin guiones', () => {
    expect(normalizeCostaRicaTaxId('3101123456')).toBe('3-101-123456');
  });

  it('limpia espacios alrededor', () => {
    expect(normalizeCostaRicaTaxId('  3-101-123456 ')).toBe('3-101-123456');
  });

  it('acepta cédula física (9 dígitos sin guiones)', () => {
    expect(normalizeCostaRicaTaxId('108880123')).toBe('108880123');
  });

  it('acepta DIMEX de 11 dígitos', () => {
    expect(normalizeCostaRicaTaxId('10001234567')).toBe('10001234567');
  });

  it('rechaza valor vacío', () => {
    expect(() => normalizeCostaRicaTaxId('')).toThrow(/requerida/);
  });

  it('rechaza letras', () => {
    expect(() => normalizeCostaRicaTaxId('3-A01-123456')).toThrow(/dígitos/);
  });

  it('rechaza longitud no reconocida', () => {
    expect(() => normalizeCostaRicaTaxId('12345')).toThrow(/no reconocido/);
  });
});
