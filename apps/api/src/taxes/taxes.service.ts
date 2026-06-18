import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ParsedCreateTax, ParsedUpdateTax } from './dto/taxes.dto';

export interface TaxView {
  id: string;
  name: string;
  rate: string;
  isActive: boolean;
}

@Injectable()
export class TaxesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: bigint): Promise<TaxView[]> {
    const rows = await this.prisma.raw.tax.findMany({
      where: { companyId },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => this.toView(r));
  }

  async getOne(companyId: bigint, id: bigint): Promise<TaxView> {
    const row = await this.prisma.raw.tax.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('Impuesto no encontrado.');
    return this.toView(row);
  }

  async create(companyId: bigint, data: ParsedCreateTax): Promise<TaxView> {
    const row = await this.prisma.client.tax.create({ data: { companyId, ...data } });
    return this.toView(row);
  }

  async update(companyId: bigint, id: bigint, data: ParsedUpdateTax): Promise<TaxView> {
    const existing = await this.prisma.raw.tax.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Impuesto no encontrado.');
    const row = await this.prisma.client.tax.update({ where: { id: existing.id }, data });
    return this.toView(row);
  }

  async remove(companyId: bigint, id: bigint): Promise<void> {
    const existing = await this.prisma.raw.tax.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Impuesto no encontrado.');
    await this.prisma.client.tax.delete({ where: { id: existing.id } });
  }

  private toView(row: {
    id: bigint;
    name: string;
    rate: Prisma.Decimal;
    isActive: boolean;
  }): TaxView {
    return {
      id: row.id.toString(),
      name: row.name,
      rate: row.rate.toString(),
      isActive: row.isActive,
    };
  }
}
