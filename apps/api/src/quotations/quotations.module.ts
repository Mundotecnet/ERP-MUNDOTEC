import { Module } from '@nestjs/common';

import { SalesOrdersModule } from '../sales-orders/sales-orders.module';
import { QuotationsController } from './quotations.controller';
import { QuotationsService } from './quotations.service';

@Module({
  imports: [SalesOrdersModule],
  controllers: [QuotationsController],
  providers: [QuotationsService],
})
export class QuotationsModule {}
