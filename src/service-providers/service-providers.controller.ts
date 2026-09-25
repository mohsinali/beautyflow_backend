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
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { RequirePermissions } from '../authorization/authorization.decorators';
import { Permission } from '../authorization/permissions';
import { CurrentTenant, CurrentUser } from '../common/decorators/current-context.decorators';
import type { AuthContext, RequestWithContext } from '../common/types/request-context';
import {
  CreateServiceProviderDto,
  OnboardServiceProviderDto,
  ReplaceQualificationsDto,
  ServiceProviderListDto,
  UpdateServiceProviderDto,
} from './dto/service-provider.dto';
import { ServiceProvidersService } from './service-providers.service';
import { ProviderPhotoService, type UploadedProviderPhoto } from './provider-photo.service';

@ApiTags('service-providers')
@ApiBearerAuth()
@Controller('service-providers')
export class ServiceProvidersController {
  constructor(
    private readonly providers: ServiceProvidersService,
    private readonly photos: ProviderPhotoService,
  ) {}
  @Post()
  @RequirePermissions(Permission.SERVICE_PROVIDER_CREATE)
  @ApiOperation({ summary: 'Create a profile for an existing Service Provider membership' })
  create(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateServiceProviderDto,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.providers.create(tenantId, dto, actor, request);
  }
  @Post('onboard')
  @RequirePermissions(Permission.SERVICE_PROVIDER_CREATE)
  @ApiOperation({ summary: 'Create or connect a provider login, membership and profile' })
  onboard(
    @CurrentTenant() tenantId: string,
    @Body() dto: OnboardServiceProviderDto,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.providers.onboard(tenantId, dto, actor, request);
  }
  @Get()
  @RequirePermissions(Permission.SERVICE_PROVIDER_READ)
  list(@CurrentUser() actor: AuthContext, @Query() query: ServiceProviderListDto) {
    return this.providers.list(actor, query);
  }
  @Get('available-memberships')
  @RequirePermissions(Permission.SERVICE_PROVIDER_CREATE)
  availableMemberships(@CurrentTenant() tenantId: string) {
    return this.providers.availableMemberships(tenantId);
  }
  @Post(':providerId/resend-invitation')
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 100 : 3, ttl: 60_000 } })
  @RequirePermissions(Permission.SERVICE_PROVIDER_CREATE)
  resendInvitation(
    @CurrentTenant() tenantId: string,
    @Param('providerId', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.providers.resendInvitation(tenantId, id, actor, request);
  }
  @Get(':providerId')
  @RequirePermissions(Permission.SERVICE_PROVIDER_READ)
  get(@CurrentUser() actor: AuthContext, @Param('providerId', ParseUUIDPipe) id: string) {
    return this.providers.get(actor, id);
  }
  @Patch(':providerId')
  @RequirePermissions(Permission.SERVICE_PROVIDER_UPDATE)
  update(
    @CurrentTenant() tenantId: string,
    @Param('providerId', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceProviderDto,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.providers.update(tenantId, id, dto, actor, request);
  }
  @Post(':providerId/photo')
  @RequirePermissions(Permission.SERVICE_PROVIDER_UPDATE)
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 20 * 1024 * 1024, files: 1 } }))
  uploadPhoto(
    @CurrentTenant() tenantId: string,
    @Param('providerId', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedProviderPhoto | undefined,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.photos.replace(tenantId, id, file, actor, request);
  }
  @Get(':providerId/photo')
  @RequirePermissions(Permission.SERVICE_PROVIDER_READ)
  async photo(
    @CurrentTenant() tenantId: string,
    @Param('providerId', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthContext,
    @Res() response: Response,
  ) {
    await this.providers.get(actor, id);
    const file = await this.photos.read(tenantId, id);
    response.set({
      'Content-Type': file.contentType,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    response.send(file.buffer);
  }
  @Delete(':providerId/photo')
  @RequirePermissions(Permission.SERVICE_PROVIDER_UPDATE)
  removePhoto(
    @CurrentTenant() tenantId: string,
    @Param('providerId', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.photos.remove(tenantId, id, actor, request);
  }
  @Post(':providerId/deactivate')
  @RequirePermissions(Permission.SERVICE_PROVIDER_DEACTIVATE)
  deactivate(
    @CurrentTenant() tenantId: string,
    @Param('providerId', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.providers.setActive(tenantId, id, false, actor, request);
  }
  @Post(':providerId/reactivate')
  @RequirePermissions(Permission.SERVICE_PROVIDER_DEACTIVATE)
  reactivate(
    @CurrentTenant() tenantId: string,
    @Param('providerId', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.providers.setActive(tenantId, id, true, actor, request);
  }
  @Get(':providerId/qualifications')
  @RequirePermissions(Permission.SERVICE_PROVIDER_READ)
  qualifications(
    @CurrentUser() actor: AuthContext,
    @Param('providerId', ParseUUIDPipe) id: string,
  ) {
    return this.providers.qualifications(actor, id);
  }
  @Put(':providerId/qualifications')
  @RequirePermissions(Permission.SERVICE_PROVIDER_MANAGE_QUALIFICATIONS)
  replace(
    @CurrentTenant() tenantId: string,
    @Param('providerId', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceQualificationsDto,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.providers.replaceQualifications(tenantId, id, dto.serviceIds, actor, request);
  }
  @Post(':providerId/qualifications/:serviceId')
  @RequirePermissions(Permission.SERVICE_PROVIDER_MANAGE_QUALIFICATIONS)
  add(
    @CurrentTenant() tenantId: string,
    @Param('providerId', ParseUUIDPipe) id: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.providers.addQualification(tenantId, id, serviceId, actor, request);
  }
  @Delete(':providerId/qualifications/:serviceId')
  @RequirePermissions(Permission.SERVICE_PROVIDER_MANAGE_QUALIFICATIONS)
  remove(
    @CurrentTenant() tenantId: string,
    @Param('providerId', ParseUUIDPipe) id: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.providers.removeQualification(tenantId, id, serviceId, actor, request);
  }
}

@ApiTags('provider-eligibility')
@ApiBearerAuth()
@Controller('branches/:branchId/catalog-services/:serviceId/eligible-providers')
export class ProviderEligibilityController {
  constructor(private readonly providers: ServiceProvidersService) {}
  @Get()
  @RequirePermissions(Permission.SERVICE_PROVIDER_READ)
  @ApiOperation({ summary: 'List structurally eligible providers; does not consider schedules' })
  list(
    @CurrentUser() actor: AuthContext,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
  ) {
    return this.providers.eligible(actor, branchId, serviceId);
  }
}
