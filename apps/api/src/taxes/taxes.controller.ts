import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { AuthUserContext, CurrentUser } from '../auth/decorators/current-user.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermission } from '../rbac/require-permission.decorator';
import {
  CreateTaxBody,
  parseCreateTaxBody,
  parseUpdateTaxBody,
  UpdateTaxBody,
} from './dto/taxes.dto';
import { TaxesService, TaxView } from './taxes.service';

function parseBigIntParam(value: string, name: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new BadRequestException(`Parámetro "${name}" no es un número válido.`);
  }
}

@Controller('taxes')
@UseGuards(PermissionsGuard)
export class TaxesController {
  constructor(private readonly svc: TaxesService) {}

  @Get()
  @RequirePermission('catalogs.tax.read')
  async list(@CurrentUser() user: AuthUserContext): Promise<TaxView[]> {
    return this.svc.list(user.companyId);
  }

  @Get(':id')
  @RequirePermission('catalogs.tax.read')
  async getOne(@CurrentUser() user: AuthUserContext, @Param('id') id: string): Promise<TaxView> {
    return this.svc.getOne(user.companyId, parseBigIntParam(id, 'id'));
  }

  @Post()
  @RequirePermission('catalogs.tax.manage')
  @HttpCode(201)
  async create(
    @CurrentUser() user: AuthUserContext,
    @Body() body: CreateTaxBody,
  ): Promise<TaxView> {
    return this.svc.create(user.companyId, parseCreateTaxBody(body));
  }

  @Patch(':id')
  @RequirePermission('catalogs.tax.manage')
  async update(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
    @Body() body: UpdateTaxBody,
  ): Promise<TaxView> {
    return this.svc.update(user.companyId, parseBigIntParam(id, 'id'), parseUpdateTaxBody(body));
  }

  @Delete(':id')
  @RequirePermission('catalogs.tax.manage')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUserContext, @Param('id') id: string): Promise<void> {
    await this.svc.remove(user.companyId, parseBigIntParam(id, 'id'));
  }
}
