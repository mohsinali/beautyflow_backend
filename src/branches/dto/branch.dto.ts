import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsTimeZone,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

const trimOptional = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

export class CreateBranchDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{1,30}$/) code?: string;
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(50) phone?: string | null;
  @IsOptional() @IsEmail() email?: string;
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(250) address?: string | null;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsString() @IsTimeZone() @MaxLength(100) timezone!: string;
}

export class UpdateBranchDto {
  @Transform(trim) @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{1,30}$/) code?: string;
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(50) phone?: string | null;
  @IsOptional() @IsEmail() email?: string;
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(250) address?: string | null;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @IsTimeZone() @MaxLength(100) timezone?: string;
}
