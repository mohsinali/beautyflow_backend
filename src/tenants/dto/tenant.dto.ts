import { Language, TenantStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class InitialBranchDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsString() @Matches(/^[A-Z0-9_-]{1,30}$/) code!: string;
  @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(250) address?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MaxLength(100) timezone?: string;
}

export class InitialOwnerDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(1) @MaxLength(100) firstName!: string;
  @IsString() @MinLength(1) @MaxLength(100) lastName!: string;
  @IsString() @MinLength(10) @MaxLength(200) password!: string;
}

export class CreateTenantDto {
  @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) slug!: string;
  @IsOptional() @IsEnum(Language) defaultLanguage: Language = Language.EN;
  @IsString() @Matches(/^[A-Z]{3}$/) currencyCode!: string;
  @IsString() @MaxLength(100) timezone!: string;
  @ValidateNested() @Type(() => InitialBranchDto) initialBranch!: InitialBranchDto;
  @ValidateNested() @Type(() => InitialOwnerDto) owner!: InitialOwnerDto;
}

export class UpdatePlatformTenantDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) name?: string;
  @IsOptional() @IsEnum(Language) defaultLanguage?: Language;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currencyCode?: string;
  @IsOptional() @IsString() @MaxLength(100) timezone?: string;
  @IsOptional() @IsEnum(TenantStatus) status?: TenantStatus;
}

export class UpdateTenantSettingsDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) name?: string;
  @IsOptional() @IsEnum(Language) defaultLanguage?: Language;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currencyCode?: string;
  @IsOptional() @IsString() @MaxLength(100) timezone?: string;
}
