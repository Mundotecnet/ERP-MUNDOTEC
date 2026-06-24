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
  Query,
  UseGuards,
} from '@nestjs/common';

import { AuthUserContext, CurrentUser } from '../auth/decorators/current-user.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermission } from '../rbac/require-permission.decorator';
import {
  CreateSalesOrderBody,
  ListSalesOrdersQuery,
  parseCreateSalesOrderBody,
  parseListSalesOrdersQuery,
  parseUpdateSalesOrderBody,
  UpdateSalesOrderBody,
} from './dto/sales-orders.dto';
import { SalesOrdersService, SalesOrderView } from './sales-orders.service';

function parseBigIntParam(value: string, name: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new BadRequestException(`Parámetro "${name}" no es un número válido.`);
  }
}

@Controller('sales-orders')
@UseGuards(PermissionsGuard)
export class SalesOrdersController {
  constructor(private readonly svc: SalesOrdersService) {}

  @Get()
  @RequirePermission('sales.order.read')
  async list(
    @CurrentUser() user: AuthUserContext,
    @Query() query: ListSalesOrdersQuery,
  ): Promise<SalesOrderView[]> {
    return this.svc.list(user.companyId, parseListSalesOrdersQuery(query));
  }

  @Get(':id')
  @RequirePermission('sales.order.read')
  async getOne(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
  ): Promise<SalesOrderView> {
    return this.svc.getOne(user.companyId, parseBigIntParam(id, 'id'));
  }

  @Post()
  @RequirePermission('sales.order.manage')
  @HttpCode(201)
  async create(
    @CurrentUser() user: AuthUserContext,
    @Body() body: CreateSalesOrderBody,
  ): Promise<SalesOrderView> {
    return this.svc.create(user.companyId, user.userId, parseCreateSalesOrderBody(body));
  }

  @Patch(':id')
  @RequirePermission('sales.order.manage')
  async update(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
    @Body() body: UpdateSalesOrderBody,
  ): Promise<SalesOrderView> {
    return this.svc.update(
      user.companyId,
      parseBigIntParam(id, 'id'),
      parseUpdateSalesOrderBody(body),
    );
  }

  @Delete(':id')
  @RequirePermission('sales.order.manage')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUserContext, @Param('id') id: string): Promise<void> {
    await this.svc.remove(user.companyId, parseBigIntParam(id, 'id'));
  }

  @Post(':id/confirm')
  @RequirePermission('sales.order.manage')
  @HttpCode(200)
  async confirm(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
  ): Promise<SalesOrderView> {
    return this.svc.confirm(user.companyId, parseBigIntParam(id, 'id'));
  }

  @Post(':id/cancel')
  @RequirePermission('sales.order.manage')
  @HttpCode(200)
  async cancel(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
  ): Promise<SalesOrderView> {
    return this.svc.cancel(user.companyId, parseBigIntParam(id, 'id'));
  }
}
