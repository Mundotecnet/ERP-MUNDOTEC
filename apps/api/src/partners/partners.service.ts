import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  ParsedCreateContact,
  ParsedCreatePartner,
  ParsedListPartnersQuery,
  ParsedUpdateContact,
  ParsedUpdatePartner,
} from './dto/partners.dto';

export interface PartnerContactView {
  id: string;
  name: string;
  position: string | null;
  email: string | null;
  phone: string | null;
}

export interface PartnerView {
  id: string;
  partnerType: string;
  code: string | null;
  legalName: string;
  tradeName: string | null;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  currencyCode: string;
  creditLimit: string;
  creditDays: number;
  isActive: boolean;
  customerCategoryId: string | null;
  createdAt: string;
  updatedAt: string;
  contacts?: PartnerContactView[];
}

interface PartnerRow {
  id: bigint;
  partnerType: string;
  code: string | null;
  legalName: string;
  tradeName: string | null;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  currencyCode: string;
  creditLimit: Prisma.Decimal;
  creditDays: number;
  isActive: boolean;
  customerCategoryId: bigint | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ContactRow {
  id: bigint;
  name: string;
  position: string | null;
  email: string | null;
  phone: string | null;
}

@Injectable()
export class PartnersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: bigint, filter: ParsedListPartnersQuery): Promise<PartnerView[]> {
    const where: Prisma.PartnerWhereInput = { companyId, deletedAt: null };
    if (filter.type === 'CUSTOMER') {
      where.partnerType = { in: ['CUSTOMER', 'BOTH'] };
    } else if (filter.type === 'SUPPLIER') {
      where.partnerType = { in: ['SUPPLIER', 'BOTH'] };
    } else if (filter.type === 'BOTH') {
      where.partnerType = 'BOTH';
    }
    if (filter.q !== null) {
      where.OR = [
        { code: { contains: filter.q, mode: 'insensitive' } },
        { legalName: { contains: filter.q, mode: 'insensitive' } },
        { tradeName: { contains: filter.q, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.raw.partner.findMany({
      where,
      orderBy: [{ legalName: 'asc' }],
    });
    return rows.map((r) => this.toView(r));
  }

  async getOne(companyId: bigint, id: bigint): Promise<PartnerView> {
    const row = await this.prisma.raw.partner.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { contacts: { orderBy: { id: 'asc' } } },
    });
    if (!row) throw new NotFoundException('Tercero no encontrado.');
    const view = this.toView(row);
    view.contacts = row.contacts.map((c) => this.toContactView(c));
    return view;
  }

  async create(companyId: bigint, data: ParsedCreatePartner): Promise<PartnerView> {
    await this.assertReferencesValid(companyId, data.currencyCode, data.customerCategoryId);
    try {
      const row = await this.prisma.client.partner.create({
        data: { companyId, ...data, updatedAt: new Date() },
      });
      return this.toView(row);
    } catch (err) {
      this.translatePrismaError(err);
    }
  }

  async update(companyId: bigint, id: bigint, data: ParsedUpdatePartner): Promise<PartnerView> {
    const existing = await this.prisma.raw.partner.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Tercero no encontrado.');
    await this.assertReferencesValid(companyId, data.currencyCode, data.customerCategoryId);
    try {
      const row = await this.prisma.client.partner.update({
        where: { id: existing.id },
        data: { ...data, updatedAt: new Date() },
      });
      return this.toView(row);
    } catch (err) {
      this.translatePrismaError(err);
    }
  }

  async remove(companyId: bigint, id: bigint): Promise<void> {
    const existing = await this.prisma.raw.partner.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Tercero no encontrado.');
    // softDelete del registry convierte el delete en update({ deletedAt }).
    await this.prisma.client.partner.delete({ where: { id: existing.id } });
  }

  async listContacts(companyId: bigint, partnerId: bigint): Promise<PartnerContactView[]> {
    await this.assertPartnerInCompany(companyId, partnerId);
    const rows = await this.prisma.raw.partnerContact.findMany({
      where: { partnerId },
      orderBy: { id: 'asc' },
    });
    return rows.map((r) => this.toContactView(r));
  }

  async createContact(
    companyId: bigint,
    partnerId: bigint,
    data: ParsedCreateContact,
  ): Promise<PartnerContactView> {
    await this.assertPartnerInCompany(companyId, partnerId);
    const row = await this.prisma.client.partnerContact.create({
      data: { partnerId, ...data },
    });
    return this.toContactView(row);
  }

  async updateContact(
    companyId: bigint,
    partnerId: bigint,
    contactId: bigint,
    data: ParsedUpdateContact,
  ): Promise<PartnerContactView> {
    await this.assertPartnerInCompany(companyId, partnerId);
    const existing = await this.prisma.raw.partnerContact.findFirst({
      where: { id: contactId, partnerId },
    });
    if (!existing) throw new NotFoundException('Contacto no encontrado.');
    const row = await this.prisma.client.partnerContact.update({
      where: { id: existing.id },
      data,
    });
    return this.toContactView(row);
  }

  async removeContact(companyId: bigint, partnerId: bigint, contactId: bigint): Promise<void> {
    await this.assertPartnerInCompany(companyId, partnerId);
    const existing = await this.prisma.raw.partnerContact.findFirst({
      where: { id: contactId, partnerId },
    });
    if (!existing) throw new NotFoundException('Contacto no encontrado.');
    // Borrado físico: el contacto no tiene `deleted_at` en el canónico y el FK
    // del partner lo cascadea al hard-delete de un partner futuro.
    await this.prisma.client.partnerContact.delete({ where: { id: existing.id } });
  }

  private async assertPartnerInCompany(companyId: bigint, partnerId: bigint): Promise<void> {
    const partner = await this.prisma.raw.partner.findFirst({
      where: { id: partnerId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!partner) throw new NotFoundException('Tercero no encontrado.');
  }

  private async assertReferencesValid(
    companyId: bigint,
    currencyCode: string | undefined,
    customerCategoryId: bigint | null | undefined,
  ): Promise<void> {
    if (currencyCode !== undefined) {
      const currency = await this.prisma.raw.currency.findUnique({
        where: { code: currencyCode },
        select: { code: true },
      });
      if (!currency) {
        throw new BadRequestException(
          `La moneda "${currencyCode}" no existe en el catálogo de monedas.`,
        );
      }
    }
    if (customerCategoryId !== undefined && customerCategoryId !== null) {
      const cat = await this.prisma.raw.customerCategory.findFirst({
        where: { id: customerCategoryId, companyId },
        select: { id: true },
      });
      if (!cat) {
        throw new BadRequestException(
          `La categoría de cliente ${customerCategoryId.toString()} no existe o no pertenece a esta empresa.`,
        );
      }
    }
  }

  private translatePrismaError(err: unknown): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException('Ya existe un tercero con ese código en esta empresa.');
    }
    throw err as Error;
  }

  private toView(row: PartnerRow): PartnerView {
    return {
      id: row.id.toString(),
      partnerType: row.partnerType,
      code: row.code,
      legalName: row.legalName,
      tradeName: row.tradeName,
      taxId: row.taxId,
      email: row.email,
      phone: row.phone,
      address: row.address,
      currencyCode: row.currencyCode,
      creditLimit: row.creditLimit.toString(),
      creditDays: row.creditDays,
      isActive: row.isActive,
      customerCategoryId:
        row.customerCategoryId === null ? null : row.customerCategoryId.toString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toContactView(row: ContactRow): PartnerContactView {
    return {
      id: row.id.toString(),
      name: row.name,
      position: row.position,
      email: row.email,
      phone: row.phone,
    };
  }
}
