import { Module } from '@nestjs/common';

import { PricingController } from './pricing/pricing.controller';
import { PricingService } from './pricing/pricing.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  controllers: [ProductsController, PricingController],
  providers: [ProductsService, PricingService],
})
export class ProductsModule {}
