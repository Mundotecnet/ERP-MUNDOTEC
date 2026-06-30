import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ParsedCreateDepartment, ParsedUpdateDepartment } from './dto/departments.dto';

export interface DepartmentView {
  id: string;
  name: string;
  isActive: boolean;
}

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: bigint): Promise<DepartmentView[]> {
    const rows = await this.prisma.raw.department.findMany({
      where: { companyId },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => this.toView(r));
  }

  async getOne(companyId: bigint, id: bigint): Promise<DepartmentView> {
    const row = await this.prisma.raw.department.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('Departamento no encontrado.');
    return this.toView(row);
  }

  async create(companyId: bigint, data: ParsedCreateDepartment): Promise<DepartmentView> {
    try {
      const row = await this.prisma.client.department.create({ data: { companyId, ...data } });
      return this.toView(row);
    } catch (err) {
      this.translateUniqueViolation(err);
      throw err;
    }
  }

  async update(
    companyId: bigint,
    id: bigint,
    data: ParsedUpdateDepartment,
  ): Promise<DepartmentView> {
    const existing = await this.prisma.raw.department.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Departamento no encontrado.');
    try {
      const row = await this.prisma.client.department.update({
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
    const existing = await this.prisma.raw.department.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Departamento no encontrado.');
    try {
      await this.prisma.client.department.delete({ where: { id: existing.id } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new ConflictException(
          `No se puede eliminar el departamento "${existing.name}": está referenciado por productos. ` +
            'Considere marcarlo como inactivo en su lugar.',
        );
      }
      throw err;
    }
  }

  private translateUniqueViolation(err: unknown): void {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException('Ya existe un departamento con ese nombre en la empresa.');
    }
  }

  private toView(row: { id: bigint; name: string; isActive: boolean }): DepartmentView {
    return { id: row.id.toString(), name: row.name, isActive: row.isActive };
  }
}
