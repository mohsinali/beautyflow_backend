import { Transform } from 'class-transformer';
import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';

const emptyToUndefined = ({ value }: { value: unknown }) => (value === '' ? undefined : value);

export class ReportScopeDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsIn(['all']) scope?: 'all';
}

export class ReportRangeDto extends ReportScopeDto {
  @IsDateString({ strict: true }) fromDate!: string;
  @IsDateString({ strict: true }) toDate!: string;
}

export class ProviderPerformanceDto extends ReportRangeDto {
  @IsOptional() @Transform(emptyToUndefined) @IsUUID() providerId?: string;
}

export class ServicePerformanceDto extends ReportRangeDto {
  @IsOptional() @Transform(emptyToUndefined) @IsUUID() categoryId?: string;
  @IsOptional() @Transform(emptyToUndefined) @IsUUID() serviceId?: string;
}
