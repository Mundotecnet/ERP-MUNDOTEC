import { Test, TestingModule } from '@nestjs/testing';
import { RequestContextService } from '../request-context/request-context.service';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [PrismaService, RequestContextService],
    }).compile();

    service = moduleRef.get<PrismaService>(PrismaService);
  });

  it('expone `raw` (PrismaClient sin extensiones) listo desde el constructor', () => {
    expect(service.raw).toBeDefined();
    expect(typeof service.raw.$connect).toBe('function');
    expect(typeof service.raw.$disconnect).toBe('function');
  });

  it('`client` lanza si no se llamó onModuleInit', () => {
    expect(() => service.client).toThrow(/no está inicializado/);
  });
});
