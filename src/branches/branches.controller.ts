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
import { CurrentTenant, CurrentUser } from '../common/decorators/current-context.decorators';
import { PaginationDto } from '../common/dto/pagination.dto';
import type { AuthContext, RequestWithContext } from '../common/types/request-context';
import { BranchesService } from './branches.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

@ApiTags('branches')
@ApiBearerAuth()
@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}
  @Post()
  @RequirePermissions(Permission.BRANCH_CREATE)
  create(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateBranchDto,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.branches.create(tenantId, dto, actor, request);
  }
  @Get()
  @RequirePermissions(Permission.BRANCH_VIEW)
  list(@CurrentUser() actor: AuthContext, @Query() query: PaginationDto) {
    return this.branches.list(actor, query);
  }
  @Get(':branchId')
  @RequirePermissions(Permission.BRANCH_VIEW)
  get(@CurrentUser() actor: AuthContext, @Param('branchId', ParseUUIDPipe) id: string) {
    return this.branches.get(actor, id);
  }
  @Patch(':branchId')
  @RequirePermissions(Permission.BRANCH_UPDATE)
  update(
    @CurrentTenant() tenantId: string,
    @Param('branchId', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBranchDto,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.branches.update(tenantId, id, dto, actor, request);
  }
  @Post(':branchId/deactivate')
  @RequirePermissions(Permission.BRANCH_DEACTIVATE)
  deactivate(
    @CurrentTenant() tenantId: string,
    @Param('branchId', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.branches.setActive(tenantId, id, false, actor, request);
  }
  @Post(':branchId/reactivate')
  @RequirePermissions(Permission.BRANCH_DEACTIVATE)
  reactivate(
    @CurrentTenant() tenantId: string,
    @Param('branchId', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.branches.setActive(tenantId, id, true, actor, request);
  }
}
