import { describe, expect, it } from 'vitest';

import { formatMoney, parseMoney } from '@/lib/money';

describe('formatMoney (estilo CR: 1.000,00)', () => {
  it('1000 → "1.000,00"', () => {
    expect(formatMoney(1000)).toBe('1.000,00');
  });

  it('1428.57 → "1.428,57"', () => {
    expect(formatMoney(1428.57)).toBe('1.428,57');
  });

  it('0 → "0,00"', () => {
    expect(formatMoney(0)).toBe('0,00');
  });

  it('142.86 → "142,86"', () => {
    expect(formatMoney(142.86)).toBe('142,86');
  });

  it('1234567.89 → "1.234.567,89" (separadores cada 3)', () => {
    expect(formatMoney(1234567.89)).toBe('1.234.567,89');
  });

  it('rellena ceros: 100 → "100,00", 100.5 → "100,50"', () => {
    expect(formatMoney(100)).toBe('100,00');
    expect(formatMoney(100.5)).toBe('100,50');
  });

  it('acepta string canónico ("142.86" → "142,86")', () => {
    expect(formatMoney('142.86')).toBe('142,86');
    expect(formatMoney('1000')).toBe('1.000,00');
  });

  it('null/undefined/"" → "0,00" (tolerante)', () => {
    expect(formatMoney(null)).toBe('0,00');
    expect(formatMoney(undefined)).toBe('0,00');
    expect(formatMoney('')).toBe('0,00');
  });

  it('valor no numérico → "0,00"', () => {
    expect(formatMoney('abc')).toBe('0,00');
  });
});

describe('parseMoney (tolerante a formato CR y canónico)', () => {
  it('"1.000,00" → 1000', () => {
    expect(parseMoney('1.000,00')).toBe(1000);
  });

  it('"1.428,57" → 1428.57', () => {
    expect(parseMoney('1.428,57')).toBe(1428.57);
  });

  it('"142,86" → 142.86 (sin separador de miles)', () => {
    expect(parseMoney('142,86')).toBe(142.86);
  });

  it('"142.86" → 142.86 (canónico también pasa)', () => {
    expect(parseMoney('142.86')).toBe(142.86);
  });

  it('"1000" → 1000 (entero sin separador)', () => {
    expect(parseMoney('1000')).toBe(1000);
  });

  it('"1.234.567,89" → 1234567.89 (miles múltiples)', () => {
    expect(parseMoney('1.234.567,89')).toBe(1234567.89);
  });

  it('"1.234" sin coma → 1234 (puntos son miles)', () => {
    expect(parseMoney('1.234')).toBe(1234);
  });

  it('"" / null / undefined → 0', () => {
    expect(parseMoney('')).toBe(0);
    expect(parseMoney(null)).toBe(0);
    expect(parseMoney(undefined)).toBe(0);
  });

  it('acepta number directo', () => {
    expect(parseMoney(1234.56)).toBe(1234.56);
  });

  it('tolera espacios alrededor', () => {
    expect(parseMoney('  1.000,00 ')).toBe(1000);
  });

  it('caracteres no numéricos → NaN', () => {
    expect(parseMoney('ab,cd')).toBeNaN();
    expect(parseMoney('$100')).toBeNaN();
  });

  it('doble coma → NaN', () => {
    expect(parseMoney('1,2,3')).toBeNaN();
  });

  it('roundtrip formatMoney(parseMoney(x)) preserva valor con 2 decimales', () => {
    const cases = ['1.000,00', '1.428,57', '0,00', '142,86', '1.234.567,89'];
    for (const c of cases) {
      expect(formatMoney(parseMoney(c))).toBe(c);
    }
  });
});
