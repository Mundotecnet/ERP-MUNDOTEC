import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  ParsedCreateExchangeRate,
  ParsedListExchangeRates,
  ParsedUpdateExchangeRate,
} from './dto/exchange-rates.dto';

export interface ExchangeRateView {
  id: string;
  currencyCode: string;
  rateDate: string; // YYYY-MM-DD
  rate: string;
}

@Injectable()
export class ExchangeRatesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ParsedListExchangeRates): Promise<ExchangeRateView[]> {
    const where: Prisma.ExchangeRateWhereInput = {};
    if (query.currencyCode) where.currencyCode = query.currencyCode;
    if (query.from || query.to) {
      where.rateDate = {};
      if (query.from) where.rateDate.gte = query.from;
      if (query.to) where.rateDate.lte = query.to;
    }
    const rows = await this.prisma.raw.exchangeRate.findMany({
      where,
      orderBy: [{ currencyCode: 'asc' }, { rateDate: 'desc' }],
      take: 500,
    });
    return rows.map((r) => this.toView(r));
  }

  async getOne(id: bigint): Promise<ExchangeRateView> {
    const row = await this.prisma.raw.exchangeRate.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Tipo de cambio no encontrado.');
    return this.toView(row);
  }

  async create(data: ParsedCreateExchangeRate): Promise<ExchangeRateView> {
    await this.assertCurrencyExists(data.currencyCode);
    try {
      const row = await this.prisma.raw.exchangeRate.create({ data });
      return this.toView(row);
    } catch (err) {
      this.translateUniqueViolation(err);
      throw err;
    }
  }

  async update(id: bigint, data: ParsedUpdateExchangeRate): Promise<ExchangeRateView> {
    const existing = await this.prisma.raw.exchangeRate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Tipo de cambio no encontrado.');
    const row = await this.prisma.raw.exchangeRate.update({ where: { id }, data });
    return this.toView(row);
  }

  async remove(id: bigint): Promise<void> {
    const existing = await this.prisma.raw.exchangeRate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Tipo de cambio no encontrado.');
    await this.prisma.raw.exchangeRate.delete({ where: { id } });
  }

  /**
   * Devuelve el tipo de cambio efectivo a una fecha (el más reciente con
   * `rate_date <= date`). Útil para conversión a la moneda base de una
   * empresa, helpers contables y reportes históricos.
   *
   * `from === to` → siempre 1. Si no se encuentra rate aplicable lanza 404.
   */
  async getEffectiveRate(
    currencyCode: string,
    date: Date,
  ): Promise<{ rate: string; rateDate: string }> {
    const row = await this.prisma.raw.exchangeRate.findFirst({
      where: { currencyCode, rateDate: { lte: date } },
      orderBy: { rateDate: 'desc' },
    });
    if (!row) {
      throw new NotFoundException(
        `Sin tipo de cambio aplicable para ${currencyCode} a la fecha ${date.toISOString().slice(0, 10)}.`,
      );
    }
    return { rate: row.rate.toString(), rateDate: row.rateDate.toISOString().slice(0, 10) };
  }

  /**
   * Convierte un monto entre dos monedas usando los tipos vigentes a la fecha.
   * Asume que las tasas son contra una moneda neutral común (por convención del
   * sistema: la moneda configurada por la empresa o USD). El cálculo es:
   *   amount * (rate[from] / rate[to]).
   */
  async convert(
    amount: string | number,
    from: string,
    to: string,
    date: Date,
  ): Promise<{ amount: string; rateUsed: string }> {
    if (from === to) {
      return { amount: typeof amount === 'string' ? amount : amount.toString(), rateUsed: '1' };
    }
    const [a, b] = await Promise.all([
      this.getEffectiveRate(from, date),
      this.getEffectiveRate(to, date),
    ]);
    const amt = typeof amount === 'string' ? Number(amount) : amount;
    if (!Number.isFinite(amt)) {
      throw new BadRequestException('Monto inválido.');
    }
    const rate = Number(a.rate) / Number(b.rate);
    return { amount: (amt * rate).toFixed(4), rateUsed: rate.toFixed(6) };
  }

  private async assertCurrencyExists(code: string): Promise<void> {
    const exists = await this.prisma.raw.currency.findUnique({
      where: { code },
      select: { code: true },
    });
    if (!exists) {
      throw new BadRequestException(`Moneda "${code}" no existe en el catálogo.`);
    }
  }

  private translateUniqueViolation(err: unknown): void {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException(
        'Ya existe un tipo de cambio para esa moneda y fecha. Usa PATCH para corregirlo.',
      );
    }
  }

  private toView(row: {
    id: bigint;
    currencyCode: string;
    rateDate: Date;
    rate: Prisma.Decimal;
  }): ExchangeRateView {
    return {
      id: row.id.toString(),
      currencyCode: row.currencyCode,
      rateDate: row.rateDate.toISOString().slice(0, 10),
      rate: row.rate.toString(),
    };
  }
}
