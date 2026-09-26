import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { VisitStatus } from '@prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const money = /^\d{1,10}(\.\d{1,2})?$/;

export class VisitItemInputDto {
  @IsUUID() catalogServiceId!: string;
  @IsOptional() @IsUUID() providerId?: string | null;
  @IsOptional() @Matches(money) chargedPrice?: string;
  @IsOptional() @Matches(money) discountAmount?: string;
}

export class CreateVisitDto {
  @IsUUID() customerId!: string;
  @IsOptional() @IsUUID() defaultProviderId?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) notes?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => VisitItemInputDto)
  items!: VisitItemInputDto[];
  @IsOptional() @IsIn([VisitStatus.DRAFT, VisitStatus.IN_PROGRESS]) status?: VisitStatus;
}

export class UpdateVisitDto {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() defaultProviderId?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) notes?: string | null;
}

export class UpdateVisitItemDto {
  @IsOptional() @IsUUID() providerId?: string | null;
  @IsOptional() @Matches(money) chargedPrice?: string;
  @IsOptional() @Matches(money) discountAmount?: string;
}

export class VisitListDto extends PaginationDto {
  @IsOptional() @IsEnum(VisitStatus) status?: VisitStatus;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) search?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsDateString() dateFrom?: string;
  @IsOptional() @IsDateString() dateTo?: string;
}
