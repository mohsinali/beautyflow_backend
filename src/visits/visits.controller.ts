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
import { RequirePermissions } from '../authorization/authorization.decorators';
import { Permission } from '../authorization/permissions';
import { CurrentUser } from '../common/decorators/current-context.decorators';
import type { AuthContext, RequestWithContext } from '../common/types/request-context';
import {
  CreateVisitDto,
  UpdateVisitDto,
  UpdateVisitItemDto,
  VisitItemInputDto,
  VisitListDto,
} from './dto/visit.dto';
import { VisitsService } from './visits.service';

@ApiTags('visits')
@ApiBearerAuth()
@Controller('visits')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}
  @Post()
  @RequirePermissions(Permission.VISIT_CREATE)
  create(
    @CurrentUser() actor: AuthContext,
    @Body() dto: CreateVisitDto,
    @Req() request: RequestWithContext,
  ) {
    return this.visits.create(actor, request.branchId, dto, request);
  }
  @Get()
  @RequirePermissions(Permission.VISIT_READ)
  list(
    @CurrentUser() actor: AuthContext,
    @Query() query: VisitListDto,
    @Req() request: RequestWithContext,
  ) {
    return this.visits.list(actor, request.branchId, query);
  }
  @Get(':visitId')
  @RequirePermissions(Permission.VISIT_READ)
  get(@CurrentUser() actor: AuthContext, @Param('visitId', ParseUUIDPipe) id: string) {
    return this.visits.get(actor, id);
  }
  @Patch(':visitId')
  @RequirePermissions(Permission.VISIT_UPDATE)
  update(
    @CurrentUser() actor: AuthContext,
    @Param('visitId', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVisitDto,
    @Req() request: RequestWithContext,
  ) {
    return this.visits.update(actor, id, dto, request);
  }
  @Post(':visitId/items')
  @RequirePermissions(Permission.VISIT_UPDATE)
  addItem(
    @CurrentUser() actor: AuthContext,
    @Param('visitId', ParseUUIDPipe) id: string,
    @Body() dto: VisitItemInputDto,
    @Req() request: RequestWithContext,
  ) {
    return this.visits.addItem(actor, id, dto, request);
  }
  @Patch(':visitId/items/:itemId')
  @RequirePermissions(Permission.VISIT_ITEM_UPDATE)
  updateItem(
    @CurrentUser() actor: AuthContext,
    @Param('visitId', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateVisitItemDto,
    @Req() request: RequestWithContext,
  ) {
    return this.visits.updateItem(actor, id, itemId, dto, request);
  }
  @Delete(':visitId/items/:itemId')
  @RequirePermissions(Permission.VISIT_ITEM_CANCEL)
  removeItem(
    @CurrentUser() actor: AuthContext,
    @Param('visitId', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Req() request: RequestWithContext,
  ) {
    return this.visits.removeItem(actor, id, itemId, request);
  }
  @Post(':visitId/start')
  @RequirePermissions(Permission.VISIT_START)
  start(
    @CurrentUser() actor: AuthContext,
    @Param('visitId', ParseUUIDPipe) id: string,
    @Req() request: RequestWithContext,
  ) {
    return this.visits.transitionVisit(actor, id, 'start', request);
  }
  @Post(':visitId/complete')
  @RequirePermissions(Permission.VISIT_COMPLETE)
  complete(
    @CurrentUser() actor: AuthContext,
    @Param('visitId', ParseUUIDPipe) id: string,
    @Req() request: RequestWithContext,
  ) {
    return this.visits.transitionVisit(actor, id, 'complete', request);
  }
  @Post(':visitId/cancel')
  @RequirePermissions(Permission.VISIT_CANCEL)
  cancel(
    @CurrentUser() actor: AuthContext,
    @Param('visitId', ParseUUIDPipe) id: string,
    @Req() request: RequestWithContext,
  ) {
    return this.visits.transitionVisit(actor, id, 'cancel', request);
  }
  @Post(':visitId/items/:itemId/start')
  @RequirePermissions(Permission.VISIT_ITEM_START)
  startItem(
    @CurrentUser() actor: AuthContext,
    @Param('visitId', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Req() request: RequestWithContext,
  ) {
    return this.visits.transitionItem(actor, id, itemId, 'start', request);
  }
  @Post(':visitId/items/:itemId/complete')
  @RequirePermissions(Permission.VISIT_ITEM_COMPLETE)
  completeItem(
    @CurrentUser() actor: AuthContext,
    @Param('visitId', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Req() request: RequestWithContext,
  ) {
    return this.visits.transitionItem(actor, id, itemId, 'complete', request);
  }
  @Post(':visitId/items/:itemId/cancel')
  @RequirePermissions(Permission.VISIT_ITEM_CANCEL)
  cancelItem(
    @CurrentUser() actor: AuthContext,
    @Param('visitId', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Req() request: RequestWithContext,
  ) {
    return this.visits.transitionItem(actor, id, itemId, 'cancel', request);
  }
}
