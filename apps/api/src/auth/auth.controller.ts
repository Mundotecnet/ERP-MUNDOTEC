import { Body, Controller, HttpCode, Post } from '@nestjs/common';

import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import {
  LoginRequestBody,
  parseLoginBody,
  parseRefreshBody,
  RefreshRequestBody,
} from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: LoginRequestBody) {
    const input = parseLoginBody(body);
    return this.auth.login(input);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() body: RefreshRequestBody) {
    const refreshToken = parseRefreshBody(body);
    return this.auth.refresh(refreshToken);
  }
}
