import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ParsedCreateCurrency, ParsedUpdateCurrency } from './dto/currencies.dto';

export interface CurrencyView {
  code: string;
  name: string;
  symbol: string | null;
  decimals: number;
  isActive: boolean;
}

interface CurrencyRow {
  code: string;
  name: string;
  symbol: string | null;
  decimals: number;
  isActive: boolean;
}

@Injectable()
export class CurrenciesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<CurrencyView[]> {
    const rows = await this.prisma.raw.currency.findMany({ orderBy: { code: 'asc' } });
    return rows.map((r) => this.toView(r));
  }

  async getOne(code: string): Promise<CurrencyView> {
    const row = await this.prisma.raw.currency.findUnique({ where: { code } });
    if (!row) throw new NotFoundException('Moneda no encontrada.');
    return this.toView(row);
  }

  async create(data: ParsedCreateCurrency): Promise<CurrencyView> {
    try {
      const row = await this.prisma.raw.currency.create({ data });
      return this.toView(row);
    } catch (err) {
      this.translateUniqueViolation(err);
      throw err;
    }
  }

  async update(code: string, data: ParsedUpdateCurrency): Promise<CurrencyView> {
    const existing = await this.prisma.raw.currency.findUnique({ where: { code } });
    if (!existing) throw new NotFoundException('Moneda no encontrada.');
    const row = await this.prisma.raw.currency.update({ where: { code }, data });
    return this.toView(row);
  }

  async remove(code: string): Promise<void> {
    const existing = await this.prisma.raw.currency.findUnique({ where: { code } });
    if (!existing) throw new NotFoundException('Moneda no encontrada.');
    const [usedAsBase, exchangeCount, priceListCount] = await Promise.all([
      this.prisma.raw.company.count({ where: { currencyCode: code } }),
      this.prisma.raw.exchangeRate.count({ where: { currencyCode: code } }),
      this.prisma.raw.priceList.count({ where: { currencyCode: code } }),
    ]);
    if (usedAsBase > 0 || exchangeCount > 0 || priceListCount > 0) {
      throw new ConflictException(
        `No se puede eliminar la moneda ${code}: está en uso por ` +
          `${usedAsBase} empresa(s), ${exchangeCount} tipo(s) de cambio y ` +
          `${priceListCount} lista(s) de precios.`,
      );
    }
    await this.prisma.raw.currency.delete({ where: { code } });
  }

  private translateUniqueViolation(err: unknown): void {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException('Ya existe una moneda con ese código.');
    }
  }

  private toView(row: CurrencyRow): CurrencyView {
    return {
      code: row.code,
      name: row.name,
      symbol: row.symbol,
      decimals: row.decimals,
      isActive: row.isActive,
    };
  }
}
