import { Module } from '@nestjs/common';
import {
  CatalogServicesController,
  BranchCatalogController,
  ServiceCategoriesController,
} from './service-catalog.controller';
import { ServiceCatalogService } from './service-catalog.service';

@Module({
  controllers: [ServiceCategoriesController, CatalogServicesController, BranchCatalogController],
  providers: [ServiceCatalogService],
  exports: [ServiceCatalogService],
})
export class ServiceCatalogModule {}
