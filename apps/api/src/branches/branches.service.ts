import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ParsedCreateBranch, ParsedUpdateBranch } from './dto/branches.dto';

export interface BranchView {
  id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
}

@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: bigint): Promise<BranchView[]> {
    const rows = await this.prisma.raw.branch.findMany({
      where: { companyId },
      orderBy: { code: 'asc' },
    });
    return rows.map((b) => this.toView(b));
  }

  async getOne(companyId: bigint, id: bigint): Promise<BranchView> {
    const row = await this.prisma.raw.branch.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('Sucursal no encontrada.');
    return this.toView(row);
  }

  async create(companyId: bigint, data: ParsedCreateBranch): Promise<BranchView> {
    try {
      const row = await this.prisma.client.branch.create({ data: { companyId, ...data } });
      return this.toView(row);
    } catch (err) {
      this.translateUniqueViolation(err);
      throw err;
    }
  }

  async update(companyId: bigint, id: bigint, data: ParsedUpdateBranch): Promise<BranchView> {
    const existing = await this.prisma.raw.branch.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Sucursal no encontrada.');
    try {
      const row = await this.prisma.client.branch.update({ where: { id: existing.id }, data });
      return this.toView(row);
    } catch (err) {
      this.translateUniqueViolation(err);
      throw err;
    }
  }

  async remove(companyId: bigint, id: bigint): Promise<void> {
    const existing = await this.prisma.raw.branch.findFirst({
      where: { id, companyId },
      include: { _count: { select: { warehouses: true } } },
    });
    if (!existing) throw new NotFoundException('Sucursal no encontrada.');
    if (existing._count.warehouses > 0) {
      throw new ConflictException(
        'No se puede eliminar la sucursal porque tiene almacenes asociados. ' +
          'Reasigna o elimina los almacenes primero.',
      );
    }
    await this.prisma.client.branch.delete({ where: { id: existing.id } });
  }

  private translateUniqueViolation(err: unknown): void {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException('Ya existe una sucursal con ese código en la empresa.');
    }
  }

  private toView(row: {
    id: bigint;
    code: string;
    name: string;
    address: string | null;
    phone: string | null;
    isActive: boolean;
  }): BranchView {
    return {
      id: row.id.toString(),
      code: row.code,
      name: row.name,
      address: row.address,
      phone: row.phone,
      isActive: row.isActive,
    };
  }
}
