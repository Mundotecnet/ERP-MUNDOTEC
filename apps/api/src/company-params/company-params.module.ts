import { Module } from '@nestjs/common';

import { CompanyParamsController } from './company-params.controller';
import { CompanyParamsService } from './company-params.service';

@Module({
  controllers: [CompanyParamsController],
  providers: [CompanyParamsService],
  exports: [CompanyParamsService],
})
export class CompanyParamsModule {}
