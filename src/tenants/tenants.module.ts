import { Module } from '@nestjs/common';
import { PlatformTenantsController } from './platform-tenants.controller';
import { TenantSettingsController } from './tenant-settings.controller';
import { TenantsService } from './tenants.service';

@Module({
  controllers: [PlatformTenantsController, TenantSettingsController],
  providers: [TenantsService],
})
export class TenantsModule {}
