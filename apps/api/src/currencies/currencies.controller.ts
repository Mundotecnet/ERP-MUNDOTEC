import {
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

import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { CurrenciesService, CurrencyView } from './currencies.service';
import {
  CreateCurrencyBody,
  parseCreateCurrencyBody,
  parseCurrencyCodeParam,
  parseUpdateCurrencyBody,
  UpdateCurrencyBody,
} from './dto/currencies.dto';

/**
 * Catálogo **global** del sistema. Cualquier empresa con
 * `catalogs.currency.read` puede listar; sólo `catalogs.currency.manage`
 * puede mutar.
 */
@Controller('currencies')
@UseGuards(PermissionsGuard)
export class CurrenciesController {
  constructor(private readonly svc: CurrenciesService) {}

  @Get()
  @RequirePermission('catalogs.currency.read')
  async list(): Promise<CurrencyView[]> {
    return this.svc.list();
  }

  @Get(':code')
  @RequirePermission('catalogs.currency.read')
  async getOne(@Param('code') code: string): Promise<CurrencyView> {
    return this.svc.getOne(parseCurrencyCodeParam(code));
  }

  @Post()
  @RequirePermission('catalogs.currency.manage')
  @HttpCode(201)
  async create(@Body() body: CreateCurrencyBody): Promise<CurrencyView> {
    return this.svc.create(parseCreateCurrencyBody(body));
  }

  @Patch(':code')
  @RequirePermission('catalogs.currency.manage')
  async update(
    @Param('code') code: string,
    @Body() body: UpdateCurrencyBody,
  ): Promise<CurrencyView> {
    return this.svc.update(parseCurrencyCodeParam(code), parseUpdateCurrencyBody(body));
  }

  @Delete(':code')
  @RequirePermission('catalogs.currency.manage')
  @HttpCode(204)
  async remove(@Param('code') code: string): Promise<void> {
    await this.svc.remove(parseCurrencyCodeParam(code));
  }
}
