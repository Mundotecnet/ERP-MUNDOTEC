import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AuthUserContext, CurrentUser } from '../auth/decorators/current-user.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermission } from '../rbac/require-permission.decorator';
import {
  CreateGoodsReceiptBody,
  ListGoodsReceiptsQuery,
  parseCreateGoodsReceiptBody,
  parseListGoodsReceiptsQuery,
} from './dto/goods-receipts.dto';
import { GoodsReceiptsService, GoodsReceiptView } from './goods-receipts.service';

function parseBigIntParam(value: string, name: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new BadRequestException(`Parámetro "${name}" no es un número válido.`);
  }
}

@Controller('goods-receipts')
@UseGuards(PermissionsGuard)
export class GoodsReceiptsController {
  constructor(private readonly svc: GoodsReceiptsService) {}

  @Get()
  @RequirePermission('purchases.receipt.read')
  async list(
    @CurrentUser() user: AuthUserContext,
    @Query() query: ListGoodsReceiptsQuery,
  ): Promise<GoodsReceiptView[]> {
    return this.svc.list(user.companyId, parseListGoodsReceiptsQuery(query));
  }

  @Get(':id')
  @RequirePermission('purchases.receipt.read')
  async getOne(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
  ): Promise<GoodsReceiptView> {
    return this.svc.getOne(user.companyId, parseBigIntParam(id, 'id'));
  }

  @Post()
  @RequirePermission('purchases.receipt.manage')
  @HttpCode(201)
  async create(
    @CurrentUser() user: AuthUserContext,
    @Body() body: CreateGoodsReceiptBody,
  ): Promise<GoodsReceiptView> {
    return this.svc.create(user.companyId, user.userId, parseCreateGoodsReceiptBody(body));
  }
}
