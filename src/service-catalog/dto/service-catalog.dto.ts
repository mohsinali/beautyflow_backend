import { Type, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const boolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

export class CreateServiceCategoryDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @Matches(/^#[0-9A-Fa-f]{6}$/) color?: string;
  @IsOptional() @Matches(/^[A-Za-z0-9_-]{1,50}$/) iconKey?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) sortOrder = 0;
}

export class UpdateServiceCategoryDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) description?: string | null;
  @IsOptional() @Matches(/^#[0-9A-Fa-f]{6}$/) color?: string | null;
  @IsOptional() @Matches(/^[A-Za-z0-9_-]{1,50}$/) iconKey?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) sortOrder?: number;
}

export class CategoryListDto extends PaginationDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) search?: string;
  @IsOptional() @Transform(boolean) @IsBoolean() isActive?: boolean;
}

export class CreateCatalogServiceDto {
  @IsUUID() categoryId!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @Transform(trim) @Matches(/^[\p{L}\p{N}_.-]{1,50}$/u) code?: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) defaultPrice!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10080) durationMinutes?: number;
  @IsOptional() @Matches(/^#[0-9A-Fa-f]{6}$/) color?: string;
  @IsOptional() @Matches(/^[A-Za-z0-9_-]{1,50}$/) iconKey?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) sortOrder = 0;
}

export class UpdateCatalogServiceDto {
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) name?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) description?: string | null;
  @IsOptional() @Transform(trim) @Matches(/^[\p{L}\p{N}_.-]{1,50}$/u) code?: string | null;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  defaultPrice?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10080) durationMinutes?: number | null;
  @IsOptional() @Matches(/^#[0-9A-Fa-f]{6}$/) color?: string | null;
  @IsOptional() @Matches(/^[A-Za-z0-9_-]{1,50}$/) iconKey?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) sortOrder?: number;
}

export class CatalogServiceListDto extends PaginationDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) search?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @Transform(boolean) @IsBoolean() isActive?: boolean;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) minPrice?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) maxPrice?: number;
}

export class CatalogServiceBranchDto {
  @IsOptional() @IsUUID() branchId?: string;
}

export class ConfigureBranchServiceDto {
  @IsBoolean() isAvailable!: boolean;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  priceOverride?: number | null;
}
