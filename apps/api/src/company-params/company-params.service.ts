import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ParsedPutParam } from './dto/company-params.dto';

export interface ParamView {
  key: string;
  value: unknown;
  updatedAt: string;
}

@Injectable()
export class CompanyParamsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: bigint): Promise<ParamView[]> {
    const rows = await this.prisma.raw.companyParam.findMany({
      where: { companyId },
      orderBy: { key: 'asc' },
    });
    return rows.map((r) => this.toView(r));
  }

  async getOne(companyId: bigint, key: string): Promise<ParamView> {
    const row = await this.prisma.raw.companyParam.findUnique({
      where: { companyId_key: { companyId, key } },
    });
    if (!row) throw new NotFoundException(`Parámetro "${key}" no encontrado.`);
    return this.toView(row);
  }

  /**
   * Upsert atómico por (companyId, key). Devuelve el estado final.
   * El valor puede ser cualquier JSON, incluido `null`.
   */
  async upsert(companyId: bigint, key: string, data: ParsedPutParam): Promise<ParamView> {
    const value = data.value as Prisma.InputJsonValue | typeof Prisma.JsonNull;
    const row = await this.prisma.client.companyParam.upsert({
      where: { companyId_key: { companyId, key } },
      update: { value, updatedAt: new Date() },
      create: { companyId, key, value },
    });
    return this.toView(row);
  }

  async remove(companyId: bigint, key: string): Promise<void> {
    const existing = await this.prisma.raw.companyParam.findUnique({
      where: { companyId_key: { companyId, key } },
    });
    if (!existing) throw new NotFoundException(`Parámetro "${key}" no encontrado.`);
    await this.prisma.client.companyParam.delete({
      where: { companyId_key: { companyId, key } },
    });
  }

  private toView(row: { key: string; value: unknown; updatedAt: Date }): ParamView {
    return {
      key: row.key,
      value: row.value,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
