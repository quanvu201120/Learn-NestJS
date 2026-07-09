/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Match } from '@/utils/decorator-customize';
import { Transform } from 'class-transformer';
import { UserRole } from '../types/user';
import {
    IsEmail,
    IsIn,
    IsNotEmpty,
    IsOptional,
    Matches,
    MaxLength,
} from 'class-validator';
import { VALIDATION_MESSAGES } from '@/common/constants/validation.constant';

export class CreateUserDto {
    @IsOptional()
    @MaxLength(50)
    @IsNotEmpty({ message: VALIDATION_MESSAGES.NAME_REQUIRED })
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    name?: string;

    @IsNotEmpty({ message: VALIDATION_MESSAGES.EMAIL_REQUIRED })
    @IsEmail({}, { message: VALIDATION_MESSAGES.EMAIL_INVALID })
    @Transform(({ value }) =>
        typeof value === 'string' ? value.toLowerCase().trim() : value,
    )
    email: string;

    @IsNotEmpty({ message: VALIDATION_MESSAGES.PASSWORD_REQUIRED })
    password: string;

    @IsNotEmpty({ message: VALIDATION_MESSAGES.CONFIRM_PASSWORD_REQUIRED })
    @Match('password', {
        message: VALIDATION_MESSAGES.CONFIRM_PASSWORD_NOT_MATCH,
    })
    confirmPassword: string;

    @IsOptional()
    @Transform(({ value }) => (value === '' ? null : value))
    @Matches(/^(0|\+84)(3|5|7|8|9)[0-9]{8}$/, {
        message: VALIDATION_MESSAGES.PHONE_INVALID,
    })
    phone?: string;

    @IsOptional()
    address?: string;

    @IsOptional()
    @IsIn([UserRole.USER, UserRole.ADMIN], {
        message: VALIDATION_MESSAGES.ROLE_INVALID,
    })
    role?: UserRole = UserRole.USER;
}
