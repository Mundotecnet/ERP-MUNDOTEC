import { Module } from '@nestjs/common';

import { CustomerCategoriesController } from './customer-categories.controller';
import { CustomerCategoriesService } from './customer-categories.service';

@Module({
  controllers: [CustomerCategoriesController],
  providers: [CustomerCategoriesService],
})
export class CustomerCategoriesModule {}
