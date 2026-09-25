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
import type { AuthContext, RequestWithContext } from '../common/types/request-context';
import { CustomerListDto, CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { CustomersService } from './customers.service';

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Post()
  @RequirePermissions(Permission.CUSTOMER_CREATE)
  create(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateCustomerDto,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.customers.create(tenantId, dto, actor, request);
  }

  @Get()
  @RequirePermissions(Permission.CUSTOMER_READ)
  list(@CurrentTenant() tenantId: string, @Query() query: CustomerListDto) {
    return this.customers.list(tenantId, query);
  }

  @Get(':customerId')
  @RequirePermissions(Permission.CUSTOMER_READ)
  get(@CurrentTenant() tenantId: string, @Param('customerId', ParseUUIDPipe) id: string) {
    return this.customers.get(tenantId, id);
  }

  @Patch(':customerId')
  @RequirePermissions(Permission.CUSTOMER_UPDATE)
  update(
    @CurrentTenant() tenantId: string,
    @Param('customerId', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.customers.update(tenantId, id, dto, actor, request);
  }

  @Post(':customerId/deactivate')
  @RequirePermissions(Permission.CUSTOMER_DEACTIVATE)
  deactivate(
    @CurrentTenant() tenantId: string,
    @Param('customerId', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.customers.setActive(tenantId, id, false, actor, request);
  }

  @Post(':customerId/reactivate')
  @RequirePermissions(Permission.CUSTOMER_DEACTIVATE)
  reactivate(
    @CurrentTenant() tenantId: string,
    @Param('customerId', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthContext,
    @Req() request: RequestWithContext,
  ) {
    return this.customers.setActive(tenantId, id, true, actor, request);
  }
}
