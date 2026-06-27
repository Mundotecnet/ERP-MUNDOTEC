import { Prisma } from '@prisma/client';

import { isConsistent, isOutOfMargin, marginFromPrice, priceFromMargin } from './pricing.formula';

const D = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);

describe('pricing.formula', () => {
  describe('priceFromMargin', () => {
    it('cost=100 margin=0.30 → price=142.8571', () => {
      expect(priceFromMargin(100, 0.3).toString()).toBe('142.8571');
    });

    it('cost=50 margin=0.5 → price=100', () => {
      expect(priceFromMargin(50, 0.5).toString()).toBe('100');
    });

    it('cost=100 margin=0 → price=100 (margen cero)', () => {
      expect(priceFromMargin(100, 0).toString()).toBe('100');
    });

    it('lanza si margen >= 1', () => {
      expect(() => priceFromMargin(100, 1)).toThrow(/menor a 1/);
      expect(() => priceFromMargin(100, 1.5)).toThrow();
    });

    it('lanza si margen negativo', () => {
      expect(() => priceFromMargin(100, -0.1)).toThrow(/negativo/);
    });

    it('lanza si costo cero', () => {
      expect(() => priceFromMargin(0, 0.3)).toThrow(/costo cero/);
    });

    it('acepta strings y Prisma.Decimal indistintamente', () => {
      expect(priceFromMargin('100', '0.30').toString()).toBe('142.8571');
      expect(priceFromMargin(D('100'), D('0.30')).toString()).toBe('142.8571');
    });
  });

  describe('marginFromPrice', () => {
    it('cost=100 price=142.8571 → margin=0.3 (ida y vuelta)', () => {
      const p = priceFromMargin(100, 0.3);
      expect(marginFromPrice(100, p).toString()).toBe('0.3');
    });

    it('cost=50 price=100 → margin=0.5', () => {
      expect(marginFromPrice(50, 100).toString()).toBe('0.5');
    });

    it('cost=100 price=100 → margin=0 (sin margen)', () => {
      expect(marginFromPrice(100, 100).toString()).toBe('0');
    });

    it('cost=0 price=100 → margin capeado a 0.9999 (respeta CHECK < 1)', () => {
      expect(marginFromPrice(0, 100).toString()).toBe('0.9999');
    });

    it('price=0 → margin=0', () => {
      expect(marginFromPrice(100, 0).toString()).toBe('0');
    });

    it('lanza si price < cost (margen negativo no soportado en PR-32)', () => {
      expect(() => marginFromPrice(100, 80)).toThrow(/menor al costo/);
    });
  });

  describe('isConsistent', () => {
    it('par derivado con priceFromMargin es consistente', () => {
      const p = priceFromMargin(100, 0.3);
      expect(isConsistent(100, p, 0.3)).toBe(true);
    });

    it('par desviado dentro de tolerancia 0.0001 sigue siendo consistente', () => {
      // cost=100, margin=0.3 → price=142.8571; manejamos margin=0.3001
      const p = priceFromMargin(100, 0.3);
      expect(isConsistent(100, p, 0.3001)).toBe(true);
    });

    it('par claramente inconsistente', () => {
      expect(isConsistent(100, 200, 0.3)).toBe(false);
    });

    it('price=0 con margin=0 es consistente; con margin>0 no', () => {
      expect(isConsistent(100, 0, 0)).toBe(true);
      expect(isConsistent(100, 0, 0.3)).toBe(false);
    });
  });

  describe('isOutOfMargin', () => {
    it('margin=0.2 con piso=0.3 → true', () => {
      expect(isOutOfMargin(0.2, 0.3)).toBe(true);
    });

    it('margin=0.3 con piso=0.3 → false (no es < piso)', () => {
      expect(isOutOfMargin(0.3, 0.3)).toBe(false);
    });

    it('piso=0 (no configurado) → siempre false', () => {
      expect(isOutOfMargin(0, 0)).toBe(false);
      expect(isOutOfMargin(0.5, 0)).toBe(false);
    });
  });
});
