import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AuthorizationModule } from './authorization/authorization.module';
import { BranchContextGuard } from './authorization/branch-context.guard';
import { JwtAuthGuard } from './authorization/jwt-auth.guard';
import { PermissionGuard } from './authorization/permission.guard';
import { BranchesModule } from './branches/branches.module';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { ResponseInterceptor } from './common/response.interceptor';
import { envSchema } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { MembershipsModule } from './memberships/memberships.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';
import { ServiceCatalogModule } from './service-catalog/service-catalog.module';
import { ServiceProvidersModule } from './service-providers/service-providers.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validationSchema: envSchema }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    PrismaModule,
    RedisModule,
    AuditModule,
    AuthorizationModule,
    AuthModule,
    UsersModule,
    TenantsModule,
    BranchesModule,
    MembershipsModule,
    HealthModule,
    ServiceCatalogModule,
    ServiceProvidersModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_GUARD, useClass: BranchContextGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('{*path}');
  }
}
