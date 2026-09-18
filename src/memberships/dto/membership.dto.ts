import { TenantRole } from '@prisma/client';
import {
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateMembershipDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(1) @MaxLength(100) firstName!: string;
  @IsString() @MinLength(1) @MaxLength(100) lastName!: string;
  @IsOptional() @IsString() @MinLength(10) @MaxLength(200) password?: string;
  @IsEnum(TenantRole) role!: TenantRole;
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) branchIds: string[] = [];
}

export class UpdateMembershipRoleDto {
  @IsEnum(TenantRole) role!: TenantRole;
}
