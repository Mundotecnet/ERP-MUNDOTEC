import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsGuard } from '../../rbac/permissions.guard';
import { RequirePermission } from '../../rbac/require-permission.decorator';

interface CreateCompanyDto {
  legalName?: unknown;
  tradeName?: unknown;
  taxId?: unknown;
  currencyCode?: unknown;
}

interface UpdateCompanyDto {
  legalName?: unknown;
  tradeName?: unknown;
}

function requireString(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`Campo "${name}" requerido (string no vacío).`);
  }
  if (value.length > max) {
    throw new BadRequestException(`Campo "${name}" excede ${max} caracteres.`);
  }
  return value.trim();
}

function optionalString(value: unknown, name: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, name, max);
}

/**
 * Controlador stub usado en PR-4 para ejercitar las extensiones audit / tenant
 * y validar el flujo end-to-end con tests de integración. Será reemplazado por
 * el CompaniesController real cuando llegue el sprint de gestión de empresas.
 *
 * @deprecated Reemplazar cuando se implemente el módulo Company completo.
 */
@Controller('admin/companies')
@UseGuards(PermissionsGuard)
export class AdminCompaniesController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  @RequirePermission('company.update')
  @HttpCode(201)
  async create(@Body() body: CreateCompanyDto): Promise<{ id: string }> {
    const data = {
      legalName: requireString(body.legalName, 'legalName', 200),
      tradeName: optionalString(body.tradeName, 'tradeName', 200),
      taxId: requireString(body.taxId, 'taxId', 50),
      currencyCode: optionalString(body.currencyCode, 'currencyCode', 3) ?? 'USD',
    };
    const company = await this.prisma.client.company.create({ data });
    return { id: company.id.toString() };
  }

  @Patch(':id')
  @RequirePermission('company.update')
  async update(@Param('id') id: string, @Body() body: UpdateCompanyDto): Promise<{ id: string }> {
    const data: { legalName?: string; tradeName?: string; updatedAt: Date } = {
      updatedAt: new Date(),
    };
    const legalName = optionalString(body.legalName, 'legalName', 200);
    const tradeName = optionalString(body.tradeName, 'tradeName', 200);
    if (legalName !== undefined) data.legalName = legalName;
    if (tradeName !== undefined) data.tradeName = tradeName;
    const company = await this.prisma.client.company.update({
      where: { id: BigInt(id) },
      data,
    });
    return { id: company.id.toString() };
  }

  @Delete(':id')
  @RequirePermission('company.update')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.prisma.client.company.delete({ where: { id: BigInt(id) } });
  }
}
