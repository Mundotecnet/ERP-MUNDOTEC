import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  ParsedCreateCustomerCategory,
  ParsedUpdateCustomerCategory,
} from './dto/customer-categories.dto';

export interface CustomerCategoryView {
  id: string;
  code: string;
  name: string;
}

@Injectable()
export class CustomerCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: bigint): Promise<CustomerCategoryView[]> {
    const rows = await this.prisma.raw.customerCategory.findMany({
      where: { companyId },
      orderBy: { code: 'asc' },
    });
    return rows.map((r) => this.toView(r));
  }

  async getOne(companyId: bigint, id: bigint): Promise<CustomerCategoryView> {
    const row = await this.prisma.raw.customerCategory.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('Categoría de cliente no encontrada.');
    return this.toView(row);
  }

  async create(
    companyId: bigint,
    data: ParsedCreateCustomerCategory,
  ): Promise<CustomerCategoryView> {
    try {
      const row = await this.prisma.client.customerCategory.create({
        data: { companyId, ...data },
      });
      return this.toView(row);
    } catch (err) {
      this.translateUniqueViolation(err);
      throw err;
    }
  }

  async update(
    companyId: bigint,
    id: bigint,
    data: ParsedUpdateCustomerCategory,
  ): Promise<CustomerCategoryView> {
    const existing = await this.prisma.raw.customerCategory.findFirst({
      where: { id, companyId },
    });
    if (!existing) throw new NotFoundException('Categoría de cliente no encontrada.');
    try {
      const row = await this.prisma.client.customerCategory.update({
        where: { id: existing.id },
        data,
      });
      return this.toView(row);
    } catch (err) {
      this.translateUniqueViolation(err);
      throw err;
    }
  }

  async remove(companyId: bigint, id: bigint): Promise<void> {
    const existing = await this.prisma.raw.customerCategory.findFirst({
      where: { id, companyId },
    });
    if (!existing) throw new NotFoundException('Categoría de cliente no encontrada.');
    await this.prisma.client.customerCategory.delete({ where: { id: existing.id } });
  }

  private translateUniqueViolation(err: unknown): void {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException(
        'Ya existe una categoría de cliente con ese código en la empresa.',
      );
    }
  }

  private toView(row: { id: bigint; code: string; name: string }): CustomerCategoryView {
    return { id: row.id.toString(), code: row.code, name: row.name };
  }
}
