import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PasswordPolicyService } from './password-policy.service';

@Global()
@Module({
  imports: [
    ConfigModule,
    JwtModule.register({
      // Cada signAsync pasa secret + expiresIn explícitos según el tipo de
      // token; aquí solo cargamos el módulo.
      global: false,
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, PasswordPolicyService],
  exports: [AuthService, JwtAuthGuard, JwtModule, PasswordPolicyService],
})
export class AuthModule {}
