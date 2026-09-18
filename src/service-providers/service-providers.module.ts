import { Module } from '@nestjs/common';
import { ServiceCatalogModule } from '../service-catalog/service-catalog.module';
import {
  ProviderEligibilityController,
  ServiceProvidersController,
} from './service-providers.controller';
import { ServiceProvidersService } from './service-providers.service';

@Module({
  imports: [ServiceCatalogModule],
  controllers: [ServiceProvidersController, ProviderEligibilityController],
  providers: [ServiceProvidersService],
  exports: [ServiceProvidersService],
})
export class ServiceProvidersModule {}
