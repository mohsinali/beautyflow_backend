import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-context.decorators';
import { Public } from '../common/decorators/public.decorator';
import type { AuthContext, RequestWithContext } from '../common/types/request-context';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Public()
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 100 : 5, ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: LoginDto, @Req() request: RequestWithContext) {
    return this.auth.login(dto, request);
  }

  @Public()
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 100 : 10, ttl: 60_000 } })
  @Post('refresh')
  refresh(@Body() dto: RefreshDto, @Req() request: RequestWithContext) {
    return this.auth.refresh(dto.refreshToken, request);
  }

  @ApiBearerAuth()
  @Post('logout')
  logout(@CurrentUser() user: AuthContext, @Req() request: RequestWithContext) {
    return this.auth.logout(user, request);
  }

  @ApiBearerAuth()
  @Post('logout-all')
  logoutAll(@CurrentUser() user: AuthContext, @Req() request: RequestWithContext) {
    return this.auth.logoutAll(user, request);
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: AuthContext) {
    return this.auth.me(user);
  }
}
