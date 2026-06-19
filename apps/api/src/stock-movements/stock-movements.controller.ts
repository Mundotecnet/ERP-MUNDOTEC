import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';

import { AuthUserContext, CurrentUser } from '../auth/decorators/current-user.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermission } from '../rbac/require-permission.decorator';
import {
  CreateMovementBody,
  MovementListQuery,
  parseCreateMovementBody,
  parseMovementListQuery,
  parseTransferMovementBody,
  TransferMovementBody,
} from './dto/stock-movements.dto';
import { MovementView, StockMovementsService, TransferView } from './stock-movements.service';

@Controller('stock-movements')
@UseGuards(PermissionsGuard)
export class StockMovementsController {
  constructor(private readonly svc: StockMovementsService) {}

  @Get()
  @RequirePermission('inventory.movement.read')
  async list(
    @CurrentUser() user: AuthUserContext,
    @Query() query: MovementListQuery,
  ): Promise<MovementView[]> {
    return this.svc.list(user.companyId, parseMovementListQuery(query));
  }

  @Post()
  @RequirePermission('inventory.movement.manage')
  @HttpCode(201)
  async create(
    @CurrentUser() user: AuthUserContext,
    @Body() body: CreateMovementBody,
  ): Promise<MovementView> {
    return this.svc.create(user.companyId, user.userId, parseCreateMovementBody(body));
  }

  /**
   * Transferencia atómica entre almacenes (HU-8.3). Genera dos movimientos
   * (OUT + IN) linkeados por `source_id` cruzado y `source_doc='TRANSFER'`,
   * reutilizando el mismo permiso de gestión de movimientos.
   */
  @Post('transfer')
  @RequirePermission('inventory.movement.manage')
  @HttpCode(201)
  async transfer(
    @CurrentUser() user: AuthUserContext,
    @Body() body: TransferMovementBody,
  ): Promise<TransferView> {
    return this.svc.transfer(user.companyId, user.userId, parseTransferMovementBody(body));
  }
}
