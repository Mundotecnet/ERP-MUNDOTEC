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
  CreatePurchaseOrderBody,
  ListPurchaseOrdersQuery,
  parseCreatePurchaseOrderBody,
  parseListPurchaseOrdersQuery,
  parseUpdatePurchaseOrderBody,
  UpdatePurchaseOrderBody,
} from './dto/purchase-orders.dto';
import { PurchaseOrdersService, PurchaseOrderView } from './purchase-orders.service';

function parseBigIntParam(value: string, name: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new BadRequestException(`Parámetro "${name}" no es un número válido.`);
  }
}

@Controller('purchase-orders')
@UseGuards(PermissionsGuard)
export class PurchaseOrdersController {
  constructor(private readonly svc: PurchaseOrdersService) {}

  @Get()
  @RequirePermission('purchases.po.read')
  async list(
    @CurrentUser() user: AuthUserContext,
    @Query() query: ListPurchaseOrdersQuery,
  ): Promise<PurchaseOrderView[]> {
    return this.svc.list(user.companyId, parseListPurchaseOrdersQuery(query));
  }

  @Get(':id')
  @RequirePermission('purchases.po.read')
  async getOne(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
  ): Promise<PurchaseOrderView> {
    return this.svc.getOne(user.companyId, parseBigIntParam(id, 'id'));
  }

  @Post()
  @RequirePermission('purchases.po.manage')
  @HttpCode(201)
  async create(
    @CurrentUser() user: AuthUserContext,
    @Body() body: CreatePurchaseOrderBody,
  ): Promise<PurchaseOrderView> {
    return this.svc.create(user.companyId, user.userId, parseCreatePurchaseOrderBody(body));
  }

  @Patch(':id')
  @RequirePermission('purchases.po.manage')
  async update(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
    @Body() body: UpdatePurchaseOrderBody,
  ): Promise<PurchaseOrderView> {
    return this.svc.update(
      user.companyId,
      parseBigIntParam(id, 'id'),
      parseUpdatePurchaseOrderBody(body),
    );
  }

  @Delete(':id')
  @RequirePermission('purchases.po.manage')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUserContext, @Param('id') id: string): Promise<void> {
    await this.svc.remove(user.companyId, parseBigIntParam(id, 'id'));
  }

  @Post(':id/approve')
  @RequirePermission('purchases.po.manage')
  @HttpCode(200)
  async approve(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
  ): Promise<PurchaseOrderView> {
    return this.svc.approve(user.companyId, parseBigIntParam(id, 'id'));
  }

  @Post(':id/cancel')
  @RequirePermission('purchases.po.manage')
  @HttpCode(200)
  async cancel(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
  ): Promise<PurchaseOrderView> {
    return this.svc.cancel(user.companyId, parseBigIntParam(id, 'id'));
  }
}
