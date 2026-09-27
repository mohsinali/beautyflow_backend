import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../authorization/authorization.decorators';
import { Permission } from '../authorization/permissions';
import { CurrentUser } from '../common/decorators/current-context.decorators';
import type { AuthContext } from '../common/types/request-context';
import {
  ProviderPerformanceDto,
  ReportRangeDto,
  ReportScopeDto,
  ServicePerformanceDto,
} from './dto/report.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
@RequirePermissions(Permission.REPORT_VIEW, Permission.REPORT_FINANCIAL_VIEW)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('dashboard')
  dashboard(@CurrentUser() auth: AuthContext, @Query() query: ReportScopeDto) {
    return this.reports.dashboard(auth, query);
  }

  @Get('salon-performance')
  salon(@CurrentUser() auth: AuthContext, @Query() query: ReportRangeDto) {
    return this.reports.salonPerformance(auth, query);
  }

  @Get('provider-performance')
  providers(@CurrentUser() auth: AuthContext, @Query() query: ProviderPerformanceDto) {
    return this.reports.providerPerformance(auth, query);
  }

  @Get('service-performance')
  services(@CurrentUser() auth: AuthContext, @Query() query: ServicePerformanceDto) {
    return this.reports.servicePerformance(auth, query);
  }
}
