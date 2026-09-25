import { Module } from '@nestjs/common';
import { ServiceCatalogModule } from '../service-catalog/service-catalog.module';
import {
  ProviderEligibilityController,
  ServiceProvidersController,
} from './service-providers.controller';
import { ServiceProvidersService } from './service-providers.service';
import { ProviderPhotoService } from './provider-photo.service';
import { LocalProviderPhotoStorage } from './storage/local-provider-photo-storage';
import { ProviderPhotoStorage } from './storage/provider-photo-storage';
import { InvitationsModule } from '../invitations/invitations.module';

@Module({
  imports: [ServiceCatalogModule, InvitationsModule],
  controllers: [ServiceProvidersController, ProviderEligibilityController],
  providers: [
    ServiceProvidersService,
    ProviderPhotoService,
    LocalProviderPhotoStorage,
    { provide: ProviderPhotoStorage, useExisting: LocalProviderPhotoStorage },
  ],
  exports: [ServiceProvidersService],
})
export class ServiceProvidersModule {}
