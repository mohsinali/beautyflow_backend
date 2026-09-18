import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../authorization/authorization.decorators';
import { Permission } from '../authorization/permissions';
import { CurrentTenant, CurrentUser } from '../common/decorators/current-context.decorators';
import type { AuthContext, RequestWithContext } from '../common/types/request-context';
import { UpdateTenantSettingsDto } from './dto/tenant.dto';
import { TenantsService } from './tenants.service';

@ApiTags('tenant settings')
@ApiBearerAuth()
@Controller('tenant/settings')
export class TenantSettingsController {
  constructor(private readonly tenants: TenantsService) {}
  @Get()
  @RequirePermissions(Permission.TENANT_SETTINGS_VIEW)
  get(@CurrentTenant() tenantId: string) {
    return this.tenants.settings(tenantId);
  }
  @Patch()
  @RequirePermissions(Permission.TENANT_SETTINGS_UPDATE)
  update(
    @CurrentTenant() tenantId: string,
    @Body() dto: UpdateTenantSettingsDto,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.tenants.updateSettings(tenantId, dto, actor, request);
  }
}
