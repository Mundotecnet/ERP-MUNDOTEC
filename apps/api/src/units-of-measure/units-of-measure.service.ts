import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ParsedCreateUom, ParsedUpdateUom } from './dto/units-of-measure.dto';

export interface UomView {
  id: string;
  code: string;
  name: string;
}

@Injectable()
export class UnitsOfMeasureService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<UomView[]> {
    const rows = await this.prisma.raw.unitOfMeasure.findMany({ orderBy: { code: 'asc' } });
    return rows.map((r) => this.toView(r));
  }

  async getOne(id: bigint): Promise<UomView> {
    const row = await this.prisma.raw.unitOfMeasure.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Unidad de medida no encontrada.');
    return this.toView(row);
  }

  async create(data: ParsedCreateUom): Promise<UomView> {
    try {
      const row = await this.prisma.raw.unitOfMeasure.create({ data });
      return this.toView(row);
    } catch (err) {
      this.translateUniqueViolation(err);
      throw err;
    }
  }

  async update(id: bigint, data: ParsedUpdateUom): Promise<UomView> {
    const existing = await this.prisma.raw.unitOfMeasure.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Unidad de medida no encontrada.');
    try {
      const row = await this.prisma.raw.unitOfMeasure.update({ where: { id }, data });
      return this.toView(row);
    } catch (err) {
      this.translateUniqueViolation(err);
      throw err;
    }
  }

  async remove(id: bigint): Promise<void> {
    const existing = await this.prisma.raw.unitOfMeasure.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Unidad de medida no encontrada.');
    await this.prisma.raw.unitOfMeasure.delete({ where: { id } });
  }

  private translateUniqueViolation(err: unknown): void {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException('Ya existe una unidad de medida con ese código.');
    }
  }

  private toView(row: { id: bigint; code: string; name: string }): UomView {
    return { id: row.id.toString(), code: row.code, name: row.name };
  }
}
