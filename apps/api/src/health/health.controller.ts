import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';

export interface HealthStatus {
  status: 'ok';
  uptime: number;
  timestamp: string;
}

@Controller('health')
@Public()
export class HealthController {
  @Get()
  check(): HealthStatus {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
