import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../authorization/authorization.decorators';
import { Permission } from '../authorization/permissions';
import { CurrentTenant, CurrentUser } from '../common/decorators/current-context.decorators';
import type { AuthContext, RequestWithContext } from '../common/types/request-context';
import {
  CatalogServiceListDto,
  CatalogServiceBranchDto,
  CategoryListDto,
  ConfigureBranchServiceDto,
  CreateCatalogServiceDto,
  CreateServiceCategoryDto,
  UpdateCatalogServiceDto,
  UpdateServiceCategoryDto,
} from './dto/service-catalog.dto';
import { ServiceCatalogService } from './service-catalog.service';

@ApiTags('service-categories')
@ApiBearerAuth()
@Controller('service-categories')
export class ServiceCategoriesController {
  constructor(private readonly catalog: ServiceCatalogService) {}
  @Post()
  @RequirePermissions(Permission.SERVICE_CATEGORY_CREATE)
  @ApiOperation({ summary: 'Create a tenant service category' })
  create(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateServiceCategoryDto,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.catalog.createCategory(tenantId, dto, actor, request);
  }
  @Get()
  @RequirePermissions(Permission.SERVICE_CATEGORY_READ)
  @ApiOperation({ summary: 'List service categories (active by default)' })
  list(@CurrentUser() actor: AuthContext, @Query() query: CategoryListDto) {
    return this.catalog.listCategories(actor, query);
  }
  @Get(':categoryId')
  @RequirePermissions(Permission.SERVICE_CATEGORY_READ)
  get(@CurrentUser() actor: AuthContext, @Param('categoryId', ParseUUIDPipe) id: string) {
    return this.catalog.getCategory(actor, id);
  }
  @Patch(':categoryId')
  @RequirePermissions(Permission.SERVICE_CATEGORY_UPDATE)
  update(
    @CurrentTenant() tenantId: string,
    @Param('categoryId', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceCategoryDto,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.catalog.updateCategory(tenantId, id, dto, actor, request);
  }
  @Post(':categoryId/deactivate')
  @RequirePermissions(Permission.SERVICE_CATEGORY_DEACTIVATE)
  deactivate(
    @CurrentTenant() tenantId: string,
    @Param('categoryId', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.catalog.setCategoryActive(tenantId, id, false, actor, request);
  }
  @Post(':categoryId/reactivate')
  @RequirePermissions(Permission.SERVICE_CATEGORY_DEACTIVATE)
  reactivate(
    @CurrentTenant() tenantId: string,
    @Param('categoryId', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.catalog.setCategoryActive(tenantId, id, true, actor, request);
  }
}

@ApiTags('catalog-services')
@ApiBearerAuth()
@Controller('catalog-services')
export class CatalogServicesController {
  constructor(private readonly catalog: ServiceCatalogService) {}
  @Post()
  @RequirePermissions(Permission.CATALOG_SERVICE_CREATE)
  @ApiOperation({ summary: 'Create a tenant catalog service' })
  create(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateCatalogServiceDto,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.catalog.createService(tenantId, dto, actor, request);
  }
  @Get()
  @RequirePermissions(Permission.CATALOG_SERVICE_READ)
  @ApiOperation({ summary: 'List catalog services with optional branch-effective values' })
  list(@CurrentUser() actor: AuthContext, @Query() query: CatalogServiceListDto) {
    return this.catalog.listServices(actor, query);
  }
  @Get(':serviceId')
  @RequirePermissions(Permission.CATALOG_SERVICE_READ)
  get(
    @CurrentUser() actor: AuthContext,
    @Param('serviceId', ParseUUIDPipe) id: string,
    @Query() query: CatalogServiceBranchDto,
  ) {
    return this.catalog.getService(actor, id, query.branchId);
  }
  @Patch(':serviceId')
  @RequirePermissions(Permission.CATALOG_SERVICE_UPDATE)
  update(
    @CurrentTenant() tenantId: string,
    @Param('serviceId', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCatalogServiceDto,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.catalog.updateService(tenantId, id, dto, actor, request);
  }
  @Post(':serviceId/deactivate')
  @RequirePermissions(Permission.CATALOG_SERVICE_DEACTIVATE)
  deactivate(
    @CurrentTenant() tenantId: string,
    @Param('serviceId', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.catalog.setServiceActive(tenantId, id, false, actor, request);
  }
  @Post(':serviceId/reactivate')
  @RequirePermissions(Permission.CATALOG_SERVICE_DEACTIVATE)
  reactivate(
    @CurrentTenant() tenantId: string,
    @Param('serviceId', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.catalog.setServiceActive(tenantId, id, true, actor, request);
  }
}

@ApiTags('branch-catalog')
@ApiBearerAuth()
@Controller('branches/:branchId/catalog-services')
export class BranchCatalogController {
  constructor(private readonly catalog: ServiceCatalogService) {}
  @Get()
  @RequirePermissions(Permission.CATALOG_SERVICE_READ)
  @ApiOperation({ summary: 'List branch catalog with inherited and effective prices/availability' })
  list(
    @CurrentUser() actor: AuthContext,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: CatalogServiceListDto,
  ) {
    return this.catalog.branchCatalog(actor, branchId, query);
  }
  @Put(':serviceId')
  @RequirePermissions(Permission.CATALOG_SERVICE_CONFIGURE_BRANCH)
  configure(
    @CurrentTenant() tenantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Body() dto: ConfigureBranchServiceDto,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.catalog.configureBranch(tenantId, branchId, serviceId, dto, actor, request);
  }
  @Delete(':serviceId/configuration')
  @RequirePermissions(Permission.CATALOG_SERVICE_CONFIGURE_BRANCH)
  reset(
    @CurrentTenant() tenantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.catalog.resetBranch(tenantId, branchId, serviceId, actor, request);
  }
}
