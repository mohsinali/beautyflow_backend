import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BranchContextGuard } from './branch-context.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionGuard } from './permission.guard';

@Module({
  imports: [JwtModule.register({})],
  providers: [JwtAuthGuard, PermissionGuard, BranchContextGuard],
  exports: [JwtModule, JwtAuthGuard, PermissionGuard, BranchContextGuard],
})
export class AuthorizationModule {}
