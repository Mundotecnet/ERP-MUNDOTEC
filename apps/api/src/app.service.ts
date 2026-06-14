import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getRoot(): { service: string; status: string } {
    return { service: 'mundotec-erp-api', status: 'ok' };
  }
}
