import { Prisma } from '@prisma/client';

import {
  isConsistent,
  isOutOfMargin,
  marginFromPrice,
  priceFromMargin,
  roundPrice,
} from './pricing.formula';

const D = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);

describe('pricing.formula (PR-35 — precio a 2 decimales)', () => {
  describe('roundPrice', () => {
    it('redondea HALF_UP a 2 decimales', () => {
      expect(roundPrice('142.8571').toString()).toBe('142.86');
      expect(roundPrice('142.855').toString()).toBe('142.86'); // half up
      expect(roundPrice('142.854').toString()).toBe('142.85');
      expect(roundPrice('100').toString()).toBe('100');
      expect(roundPrice('100.5').toString()).toBe('100.5');
    });
  });

  describe('priceFromMargin', () => {
    it('cost=100 margin=0.30 → price=142.86 (redondeado a 2 dec)', () => {
      expect(priceFromMargin(100, 0.3).toString()).toBe('142.86');
    });

    it('cost=50 margin=0.5 → price=100', () => {
      expect(priceFromMargin(50, 0.5).toString()).toBe('100');
    });

    it('cost=100 margin=0 → price=100 (margen cero)', () => {
      expect(priceFromMargin(100, 0).toString()).toBe('100');
    });

    it('cost=10 margin=0.30 → price=14.29 (redondeo aplica también a precios chicos)', () => {
      expect(priceFromMargin(10, 0.3).toString()).toBe('14.29');
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
      expect(priceFromMargin('100', '0.30').toString()).toBe('142.86');
      expect(priceFromMargin(D('100'), D('0.30')).toString()).toBe('142.86');
    });
  });

  describe('marginFromPrice (ya redondeado)', () => {
    it('cost=10 margin=0.30 → price=14.29, margin efectivo del precio redondeado = 0.3002', () => {
      // priceFromMargin(10, 0.3) = 10/0.7 = 14.2857 → roundPrice = 14.29.
      // Margen efectivo: (14.29-10)/14.29 = 4.29/14.29 = 0.30021 → 0.3002.
      const p = priceFromMargin(10, 0.3);
      expect(p.toString()).toBe('14.29');
      expect(marginFromPrice(10, p).toString()).toBe('0.3002');
    });

    it('cost=100 margin=0.30 → price=142.86, margin efectivo casi igual (0.3 a 4 decimales)', () => {
      // Con cost grande la pérdida del redondeo se diluye.
      const p = priceFromMargin(100, 0.3);
      expect(p.toString()).toBe('142.86');
      expect(marginFromPrice(100, p).toString()).toBe('0.3');
    });

    it('cost=50 price=100 → margin=0.5 (sin pérdida porque price no se redondea)', () => {
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

    it('lanza si price < cost (margen negativo no soportado)', () => {
      expect(() => marginFromPrice(100, 80)).toThrow(/menor al costo/);
    });
  });

  describe('isConsistent (post-redondeo)', () => {
    it('par derivado con priceFromMargin es consistente con el margen original', () => {
      // priceFromMargin(100, 0.3) = 142.86; verifica que (cost, 142.86, 0.3)
      // siga siendo consistente porque expected price = 142.86 = sIn redondeado.
      const p = priceFromMargin(100, 0.3);
      expect(isConsistent(100, p, 0.3)).toBe(true);
    });

    it('cliente envía precio sin redondear (142.8571) + margin 0.3 → consistente (se redondea ambos lados)', () => {
      expect(isConsistent(100, '142.8571', 0.3)).toBe(true);
    });

    it('par claramente inconsistente', () => {
      expect(isConsistent(100, 200, 0.3)).toBe(false);
    });

    it('margen 0.3001 ya no es consistente con 142.86 (genera otro precio redondeado)', () => {
      // priceFromMargin(100, 0.3001) = 100/0.6999 = 142.8775 → 142.88.
      // sIn 142.86 redondeado = 142.86 ≠ 142.88 → rechaza.
      expect(isConsistent(100, '142.86', 0.3001)).toBe(false);
    });

    it('price=0 con margin=0 es consistente; con margin>0 no', () => {
      expect(isConsistent(100, 0, 0)).toBe(true);
      expect(isConsistent(100, 0, 0.3)).toBe(false);
    });

    it('cost=0 acepta solo margin=0 (no se puede derivar precio)', () => {
      expect(isConsistent(0, 100, 0)).toBe(true);
      expect(isConsistent(0, 100, 0.3)).toBe(false);
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
