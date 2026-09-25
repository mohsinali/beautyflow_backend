import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ValidateInvitationDto {
  @IsString() @MinLength(40) @MaxLength(500) token!: string;
}

export class AcceptInvitationDto extends ValidateInvitationDto {
  @IsOptional() @IsString() @MinLength(10) @MaxLength(200) password?: string;
  @IsOptional() @IsString() @MinLength(10) @MaxLength(200) confirmPassword?: string;
}
