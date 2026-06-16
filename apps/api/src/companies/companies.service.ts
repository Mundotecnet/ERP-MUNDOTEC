import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { ParsedUpdateCompany } from './dto/update-company.dto';

export interface CompanyView {
  id: string;
  legalName: string;
  tradeName: string | null;
  taxId: string;
  currencyCode: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lee la empresa del usuario autenticado. El controller pasa el companyId
   * extraído del JWT (`@CurrentUser`); aquí no derivamos contexto. La
   * extensión Prisma `tenant` actúa como red de seguridad si alguien por
   * descuido en otro flujo intentara leer una empresa ajena.
   */
  async getById(companyId: bigint): Promise<CompanyView> {
    const row = await this.prisma.raw.company.findUnique({ where: { id: companyId } });
    if (!row) {
      throw new NotFoundException('La empresa no existe o ya no es accesible.');
    }
    return this.toView(row);
  }

  async update(companyId: bigint, data: ParsedUpdateCompany): Promise<CompanyView> {
    const updated = await this.prisma.client.company.update({
      where: { id: companyId },
      data: { ...data, updatedAt: new Date() },
    });
    return this.toView(updated);
  }

  private toView(row: {
    id: bigint;
    legalName: string;
    tradeName: string | null;
    taxId: string;
    currencyCode: string;
    address: string | null;
    phone: string | null;
    email: string | null;
    logoUrl: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): CompanyView {
    return {
      id: row.id.toString(),
      legalName: row.legalName,
      tradeName: row.tradeName,
      taxId: row.taxId,
      currencyCode: row.currencyCode,
      address: row.address,
      phone: row.phone,
      email: row.email,
      logoUrl: row.logoUrl,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
