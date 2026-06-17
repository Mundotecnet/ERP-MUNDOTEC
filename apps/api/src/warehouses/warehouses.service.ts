import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ParsedCreateWarehouse, ParsedUpdateWarehouse } from './dto/warehouses.dto';

export interface WarehouseView {
  id: string;
  code: string;
  name: string;
  branchId: string | null;
  isActive: boolean;
}

@Injectable()
export class WarehousesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: bigint): Promise<WarehouseView[]> {
    const rows = await this.prisma.raw.warehouse.findMany({
      where: { companyId },
      orderBy: { code: 'asc' },
    });
    return rows.map((w) => this.toView(w));
  }

  async getOne(companyId: bigint, id: bigint): Promise<WarehouseView> {
    const row = await this.prisma.raw.warehouse.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('Almacén no encontrado.');
    return this.toView(row);
  }

  async create(companyId: bigint, data: ParsedCreateWarehouse): Promise<WarehouseView> {
    if (data.branchId !== null) {
      await this.assertBranchInCompany(companyId, data.branchId);
    }
    try {
      const row = await this.prisma.client.warehouse.create({
        data: {
          companyId,
          code: data.code,
          name: data.name,
          branchId: data.branchId,
          isActive: data.isActive,
        },
      });
      return this.toView(row);
    } catch (err) {
      this.translateUniqueViolation(err);
      throw err;
    }
  }

  async update(companyId: bigint, id: bigint, data: ParsedUpdateWarehouse): Promise<WarehouseView> {
    const existing = await this.prisma.raw.warehouse.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Almacén no encontrado.');
    if (data.branchId !== undefined && data.branchId !== null) {
      await this.assertBranchInCompany(companyId, data.branchId);
    }
    try {
      const row = await this.prisma.client.warehouse.update({
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
    const existing = await this.prisma.raw.warehouse.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Almacén no encontrado.');
    await this.prisma.client.warehouse.delete({ where: { id: existing.id } });
  }

  private async assertBranchInCompany(companyId: bigint, branchId: bigint): Promise<void> {
    const exists = await this.prisma.raw.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
    if (!exists) {
      throw new BadRequestException(
        `La sucursal ${branchId.toString()} no existe o no pertenece a esta empresa.`,
      );
    }
  }

  private translateUniqueViolation(err: unknown): void {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException('Ya existe un almacén con ese código en la empresa.');
    }
  }

  private toView(row: {
    id: bigint;
    code: string;
    name: string;
    branchId: bigint | null;
    isActive: boolean;
  }): WarehouseView {
    return {
      id: row.id.toString(),
      code: row.code,
      name: row.name,
      branchId: row.branchId === null ? null : row.branchId.toString(),
      isActive: row.isActive,
    };
  }
}
