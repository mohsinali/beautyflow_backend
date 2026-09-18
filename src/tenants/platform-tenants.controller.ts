import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../authorization/authorization.decorators';
import { Permission } from '../authorization/permissions';
import { CurrentUser } from '../common/decorators/current-context.decorators';
import { PaginationDto } from '../common/dto/pagination.dto';
import type { AuthContext, RequestWithContext } from '../common/types/request-context';
import { CreateTenantDto, UpdatePlatformTenantDto } from './dto/tenant.dto';
import { TenantsService } from './tenants.service';

@ApiTags('platform tenants')
@ApiBearerAuth()
@Controller('platform/tenants')
export class PlatformTenantsController {
  constructor(private readonly tenants: TenantsService) {}
  @Post()
  @RequirePermissions(Permission.PLATFORM_TENANT_CREATE)
  create(
    @Body() dto: CreateTenantDto,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.tenants.create(dto, actor, request);
  }
  @Get()
  @RequirePermissions(Permission.PLATFORM_TENANT_VIEW)
  list(@Query() query: PaginationDto) {
    return this.tenants.list(query);
  }
  @Get(':tenantId')
  @RequirePermissions(Permission.PLATFORM_TENANT_VIEW)
  get(@Param('tenantId', ParseUUIDPipe) id: string) {
    return this.tenants.get(id);
  }
  @Patch(':tenantId')
  @RequirePermissions(Permission.PLATFORM_TENANT_UPDATE)
  update(
    @Param('tenantId', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlatformTenantDto,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.tenants.platformUpdate(id, dto, actor, request);
  }
  @Post(':tenantId/suspend')
  @RequirePermissions(Permission.PLATFORM_TENANT_SUSPEND)
  suspend(
    @Param('tenantId', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.tenants.setStatus(id, 'SUSPENDED', actor, request);
  }
  @Post(':tenantId/reactivate')
  @RequirePermissions(Permission.PLATFORM_TENANT_REACTIVATE)
  reactivate(
    @Param('tenantId', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.tenants.setStatus(id, 'ACTIVE', actor, request);
  }
}
