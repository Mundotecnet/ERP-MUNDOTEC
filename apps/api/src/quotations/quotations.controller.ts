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
  CreateQuotationBody,
  ListQuotationsQuery,
  parseCreateQuotationBody,
  parseListQuotationsQuery,
  parseUpdateQuotationBody,
  UpdateQuotationBody,
} from './dto/quotations.dto';
import { ConvertQuotationResult, QuotationsService, QuotationView } from './quotations.service';

interface ConvertBody {
  orderNumber?: unknown;
  branchId?: unknown;
}

function parseConvertBody(body: ConvertBody): { orderNumber: string; branchId?: bigint | null } {
  if (typeof body.orderNumber !== 'string' || body.orderNumber.trim().length === 0) {
    throw new BadRequestException('Campo "orderNumber" requerido para crear la orden de venta.');
  }
  const orderNumber = body.orderNumber.trim();
  if (orderNumber.length > 30) {
    throw new BadRequestException('Campo "orderNumber" excede 30 caracteres.');
  }
  if (body.branchId === undefined) return { orderNumber };
  if (body.branchId === null) return { orderNumber, branchId: null };
  if (typeof body.branchId !== 'string' && typeof body.branchId !== 'number') {
    throw new BadRequestException('Campo "branchId" debe ser string, number o null.');
  }
  try {
    return { orderNumber, branchId: BigInt(body.branchId) };
  } catch {
    throw new BadRequestException('Campo "branchId" no es un número válido.');
  }
}

function parseBigIntParam(value: string, name: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new BadRequestException(`Parámetro "${name}" no es un número válido.`);
  }
}

@Controller('quotations')
@UseGuards(PermissionsGuard)
export class QuotationsController {
  constructor(private readonly svc: QuotationsService) {}

  @Get()
  @RequirePermission('sales.quote.read')
  async list(
    @CurrentUser() user: AuthUserContext,
    @Query() query: ListQuotationsQuery,
  ): Promise<QuotationView[]> {
    return this.svc.list(user.companyId, parseListQuotationsQuery(query));
  }

  @Get(':id')
  @RequirePermission('sales.quote.read')
  async getOne(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
  ): Promise<QuotationView> {
    return this.svc.getOne(user.companyId, parseBigIntParam(id, 'id'));
  }

  @Post()
  @RequirePermission('sales.quote.manage')
  @HttpCode(201)
  async create(
    @CurrentUser() user: AuthUserContext,
    @Body() body: CreateQuotationBody,
  ): Promise<QuotationView> {
    return this.svc.create(user.companyId, user.userId, parseCreateQuotationBody(body));
  }

  @Patch(':id')
  @RequirePermission('sales.quote.manage')
  async update(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
    @Body() body: UpdateQuotationBody,
  ): Promise<QuotationView> {
    return this.svc.update(
      user.companyId,
      parseBigIntParam(id, 'id'),
      parseUpdateQuotationBody(body),
    );
  }

  @Delete(':id')
  @RequirePermission('sales.quote.manage')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUserContext, @Param('id') id: string): Promise<void> {
    await this.svc.remove(user.companyId, parseBigIntParam(id, 'id'));
  }

  @Post(':id/send')
  @RequirePermission('sales.quote.manage')
  @HttpCode(200)
  async send(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
  ): Promise<QuotationView> {
    return this.svc.send(user.companyId, parseBigIntParam(id, 'id'));
  }

  @Post(':id/accept')
  @RequirePermission('sales.quote.manage')
  @HttpCode(200)
  async accept(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
  ): Promise<QuotationView> {
    return this.svc.accept(user.companyId, parseBigIntParam(id, 'id'));
  }

  @Post(':id/reject')
  @RequirePermission('sales.quote.manage')
  @HttpCode(200)
  async reject(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
  ): Promise<QuotationView> {
    return this.svc.reject(user.companyId, parseBigIntParam(id, 'id'));
  }

  @Post(':id/expire')
  @RequirePermission('sales.quote.manage')
  @HttpCode(200)
  async expire(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
  ): Promise<QuotationView> {
    return this.svc.expire(user.companyId, parseBigIntParam(id, 'id'));
  }

  /**
   * Convierte una cotización ACCEPTED en orden de venta DRAFT. Requiere
   * permiso de gestión de OV además del de cotizaciones (la conversión crea
   * un documento de venta nuevo).
   */
  @Post(':id/convert')
  @RequirePermission('sales.order.manage')
  @HttpCode(201)
  async convert(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
    @Body() body: ConvertBody,
  ): Promise<ConvertQuotationResult> {
    const parsed = parseConvertBody(body);
    return this.svc.convert(user.companyId, user.userId, parseBigIntParam(id, 'id'), parsed);
  }
}
