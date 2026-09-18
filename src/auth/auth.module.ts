import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({ imports: [AuthorizationModule], controllers: [AuthController], providers: [AuthService] })
export class AuthModule {}
