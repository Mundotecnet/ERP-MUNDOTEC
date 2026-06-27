import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';

import { AuthUserContext, CurrentUser } from '../../auth/decorators/current-user.decorator';
import { PermissionsGuard } from '../../rbac/permissions.guard';
import { RequirePermission } from '../../rbac/require-permission.decorator';
import { parseUpdatePricingBody, UpdatePricingBody } from './pricing.dto';
import { PricingHistoryEntry, PricingService, PricingView } from './pricing.service';

function parseBigIntParam(value: string, name: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new BadRequestException(`Parámetro "${name}" no es un número válido.`);
  }
}

@Controller('products/:id/pricing')
@UseGuards(PermissionsGuard)
export class PricingController {
  constructor(private readonly svc: PricingService) {}

  @Get()
  @RequirePermission('pricing.read')
  async get(@CurrentUser() user: AuthUserContext, @Param('id') id: string): Promise<PricingView> {
    return this.svc.getPricing(user.companyId, parseBigIntParam(id, 'id'));
  }

  @Patch()
  @RequirePermission('pricing.item.manage')
  async update(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
    @Body() body: UpdatePricingBody,
  ): Promise<PricingView> {
    return this.svc.updatePricing(
      user.companyId,
      user.userId,
      parseBigIntParam(id, 'id'),
      parseUpdatePricingBody(body),
    );
  }

  @Get('history')
  @RequirePermission('pricing.read')
  async history(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
  ): Promise<PricingHistoryEntry[]> {
    return this.svc.getHistory(user.companyId, parseBigIntParam(id, 'id'));
  }
}
