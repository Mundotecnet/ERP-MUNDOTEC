import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { AuthUserContext, CurrentUser } from '../auth/decorators/current-user.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { parseStockListQuery, StockListQuery } from './dto/stock.dto';
import { StockService, StockView } from './stock.service';

@Controller('stock')
@UseGuards(PermissionsGuard)
export class StockController {
  constructor(private readonly svc: StockService) {}

  @Get()
  @RequirePermission('inventory.stock.read')
  async list(
    @CurrentUser() user: AuthUserContext,
    @Query() query: StockListQuery,
  ): Promise<StockView[]> {
    return this.svc.list(user.companyId, parseStockListQuery(query));
  }
}
