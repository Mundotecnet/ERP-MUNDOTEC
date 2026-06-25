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
  CreateInvoiceBody,
  ListInvoicesQuery,
  parseCreateInvoiceBody,
  parseListInvoicesQuery,
} from './dto/invoices.dto';
import { InvoicesService, InvoiceView } from './invoices.service';

function parseBigIntParam(value: string, name: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new BadRequestException(`Parámetro "${name}" no es un número válido.`);
  }
}

@Controller('invoices')
@UseGuards(PermissionsGuard)
export class InvoicesController {
  constructor(private readonly svc: InvoicesService) {}

  @Get()
  @RequirePermission('sales.invoice.read')
  async list(
    @CurrentUser() user: AuthUserContext,
    @Query() query: ListInvoicesQuery,
  ): Promise<InvoiceView[]> {
    return this.svc.list(user.companyId, parseListInvoicesQuery(query));
  }

  @Get(':id')
  @RequirePermission('sales.invoice.read')
  async getOne(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
  ): Promise<InvoiceView> {
    return this.svc.getOne(user.companyId, parseBigIntParam(id, 'id'));
  }

  @Post()
  @RequirePermission('sales.invoice.manage')
  @HttpCode(201)
  async create(
    @CurrentUser() user: AuthUserContext,
    @Body() body: CreateInvoiceBody,
  ): Promise<InvoiceView> {
    return this.svc.create(user.companyId, user.userId, parseCreateInvoiceBody(body));
  }

  @Post(':id/cancel')
  @RequirePermission('sales.invoice.manage')
  @HttpCode(200)
  async cancel(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
  ): Promise<InvoiceView> {
    return this.svc.cancel(user.companyId, parseBigIntParam(id, 'id'));
  }
}
