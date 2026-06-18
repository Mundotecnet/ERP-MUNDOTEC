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

import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermission } from '../rbac/require-permission.decorator';
import {
  CreateExchangeRateBody,
  ListExchangeRatesQuery,
  parseCreateExchangeRateBody,
  parseListExchangeRatesQuery,
  parseUpdateExchangeRateBody,
  UpdateExchangeRateBody,
} from './dto/exchange-rates.dto';
import { ExchangeRatesService, ExchangeRateView } from './exchange-rates.service';

function parseBigIntParam(value: string, name: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new BadRequestException(`Parámetro "${name}" no es un número válido.`);
  }
}

/**
 * Catálogo global del sistema (sin company_id). Helper de conversión expuesto
 * en `GET /exchange-rates/convert`.
 */
@Controller('exchange-rates')
@UseGuards(PermissionsGuard)
export class ExchangeRatesController {
  constructor(private readonly svc: ExchangeRatesService) {}

  @Get()
  @RequirePermission('catalogs.exchange-rate.read')
  async list(@Query() query: ListExchangeRatesQuery): Promise<ExchangeRateView[]> {
    return this.svc.list(parseListExchangeRatesQuery(query));
  }

  /**
   * Convierte un monto entre monedas usando los tipos vigentes a una fecha.
   * Devuelve `{ amount, rateUsed }`. Si `from === to`, rateUsed = "1".
   */
  @Get('convert')
  @RequirePermission('catalogs.exchange-rate.read')
  async convert(
    @Query('amount') amount: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('date') date: string,
  ): Promise<{ amount: string; rateUsed: string }> {
    if (!amount || !from || !to || !date) {
      throw new BadRequestException('Parámetros requeridos: amount, from, to, date.');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Parámetro "date" en formato YYYY-MM-DD.');
    }
    return this.svc.convert(
      amount,
      from.toUpperCase(),
      to.toUpperCase(),
      new Date(`${date}T00:00:00.000Z`),
    );
  }

  @Get(':id')
  @RequirePermission('catalogs.exchange-rate.read')
  async getOne(@Param('id') id: string): Promise<ExchangeRateView> {
    return this.svc.getOne(parseBigIntParam(id, 'id'));
  }

  @Post()
  @RequirePermission('catalogs.exchange-rate.manage')
  @HttpCode(201)
  async create(@Body() body: CreateExchangeRateBody): Promise<ExchangeRateView> {
    return this.svc.create(parseCreateExchangeRateBody(body));
  }

  @Patch(':id')
  @RequirePermission('catalogs.exchange-rate.manage')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateExchangeRateBody,
  ): Promise<ExchangeRateView> {
    return this.svc.update(parseBigIntParam(id, 'id'), parseUpdateExchangeRateBody(body));
  }

  @Delete(':id')
  @RequirePermission('catalogs.exchange-rate.manage')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.svc.remove(parseBigIntParam(id, 'id'));
  }
}
