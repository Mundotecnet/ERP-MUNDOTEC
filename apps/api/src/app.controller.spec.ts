import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let controller: AppController;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    controller = moduleRef.get<AppController>(AppController);
  });

  it('responde con el nombre del servicio y status ok', () => {
    expect(controller.getRoot()).toEqual({
      service: 'mundotec-erp-api',
      status: 'ok',
    });
  });
});
