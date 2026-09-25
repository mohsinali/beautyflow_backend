import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const phonePattern = /^\+?[0-9\s().-]*$/;

export class CreateCustomerDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(50) @Matches(phonePattern) phone?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsUUID() preferredBranchId?: string;
}

export class UpdateCustomerDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) name?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(50) @Matches(phonePattern) phone?:
    string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) notes?: string | null;
  @IsOptional() @IsUUID() preferredBranchId?: string | null;
}

export enum CustomerStatusFilter {
  ALL = 'ALL',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export class CustomerListDto extends PaginationDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) search?: string;
  @IsOptional() @IsEnum(CustomerStatusFilter) status: CustomerStatusFilter =
    CustomerStatusFilter.ACTIVE;
}
