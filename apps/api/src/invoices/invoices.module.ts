import { Module } from '@nestjs/common';

import { StockMovementsModule } from '../stock-movements/stock-movements.module';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

@Module({
  imports: [StockMovementsModule],
  controllers: [InvoicesController],
  providers: [InvoicesService],
})
export class InvoicesModule {}
