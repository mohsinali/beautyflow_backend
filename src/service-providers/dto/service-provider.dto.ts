import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const boolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

export class CreateServiceProviderDto {
  @IsUUID() membershipId!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) displayName!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(50) phone?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) jobTitle?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) bio?: string;
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  profileImageUrl?: string;
}

export class OnboardServiceProviderDto {
  @Transform(trim) @IsEmail() @MaxLength(320) email!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) displayName!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(50) phone?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) jobTitle?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) bio?: string;
  @IsBoolean() isActive!: boolean;
}

export class UpdateServiceProviderDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) displayName?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(50) phone?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) jobTitle?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) bio?: string | null;
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  profileImageUrl?: string | null;
}

export class ServiceProviderListDto extends PaginationDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) search?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() catalogServiceId?: string;
  @IsOptional() @Transform(boolean) @IsBoolean() isActive?: boolean;
}

export class ReplaceQualificationsDto {
  @IsArray() @ArrayMaxSize(500) @IsUUID('4', { each: true }) serviceIds!: string[];
}
