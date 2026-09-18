import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MembershipStatus } from '@prisma/client';
import { RequirePermissions } from '../authorization/authorization.decorators';
import { Permission } from '../authorization/permissions';
import { CurrentTenant, CurrentUser } from '../common/decorators/current-context.decorators';
import { PaginationDto } from '../common/dto/pagination.dto';
import type { AuthContext, RequestWithContext } from '../common/types/request-context';
import { CreateMembershipDto, UpdateMembershipRoleDto } from './dto/membership.dto';
import { MembershipsService } from './memberships.service';

@ApiTags('memberships')
@ApiBearerAuth()
@Controller('memberships')
export class MembershipsController {
  constructor(private readonly memberships: MembershipsService) {}
  @Get()
  @RequirePermissions(Permission.STAFF_VIEW)
  list(@CurrentTenant() tenantId: string, @Query() query: PaginationDto) {
    return this.memberships.list(tenantId, query);
  }
  @Post()
  @RequirePermissions(Permission.STAFF_CREATE)
  create(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateMembershipDto,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.memberships.create(tenantId, dto, actor, request);
  }
  @Get(':membershipId')
  @RequirePermissions(Permission.STAFF_VIEW)
  get(@CurrentTenant() tenantId: string, @Param('membershipId', ParseUUIDPipe) id: string) {
    return this.memberships.get(tenantId, id);
  }
  @Patch(':membershipId/role')
  @RequirePermissions(Permission.MEMBERSHIP_ROLE_ASSIGN)
  role(
    @CurrentTenant() tenantId: string,
    @Param('membershipId', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMembershipRoleDto,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.memberships.updateRole(tenantId, id, dto.role, actor, request);
  }
  @Post(':membershipId/suspend')
  @RequirePermissions(Permission.STAFF_SUSPEND)
  suspend(
    @CurrentTenant() tenantId: string,
    @Param('membershipId', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.memberships.setStatus(tenantId, id, MembershipStatus.SUSPENDED, actor, request);
  }
  @Post(':membershipId/reactivate')
  @RequirePermissions(Permission.STAFF_SUSPEND)
  reactivate(
    @CurrentTenant() tenantId: string,
    @Param('membershipId', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.memberships.setStatus(tenantId, id, MembershipStatus.ACTIVE, actor, request);
  }
  @Post(':membershipId/branches/:branchId')
  @RequirePermissions(Permission.BRANCH_ACCESS_ASSIGN)
  assign(
    @CurrentTenant() tenantId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.memberships.assignBranch(tenantId, membershipId, branchId, actor, request);
  }
  @Delete(':membershipId/branches/:branchId')
  @RequirePermissions(Permission.BRANCH_ACCESS_ASSIGN)
  remove(
    @CurrentTenant() tenantId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.memberships.removeBranch(tenantId, membershipId, branchId, actor, request);
  }
}
