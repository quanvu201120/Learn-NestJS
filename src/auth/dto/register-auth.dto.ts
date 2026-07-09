/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Match } from '@/utils/decorator-customize';
import { IsEmail, IsNotEmpty, MinLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { VALIDATION_MESSAGES } from '@/common/constants/validation.constant';

export class RegisterAuthDto {
    @IsEmail({}, { message: VALIDATION_MESSAGES.EMAIL_INVALID })
    @IsNotEmpty({ message: VALIDATION_MESSAGES.EMAIL_REQUIRED })
    @Transform(({ value }) =>
        typeof value === 'string' ? value.toLowerCase().trim() : value,
    )
    email: string;

    @MinLength(6, { message: VALIDATION_MESSAGES.PASSWORD_MIN_LENGTH })
    @IsNotEmpty({ message: VALIDATION_MESSAGES.PASSWORD_REQUIRED })
    password: string;

    @MinLength(6, { message: VALIDATION_MESSAGES.CONFIRM_PASSWORD_MIN_LENGTH })
    @IsNotEmpty({ message: VALIDATION_MESSAGES.CONFIRM_PASSWORD_REQUIRED })
    @Match('password', {
        message: VALIDATION_MESSAGES.CONFIRM_PASSWORD_NOT_MATCH,
    })
    confirmPassword: string;
}

export class LoginDto {
    @IsNotEmpty({ message: VALIDATION_MESSAGES.EMAIL_OR_PHONE_REQUIRED })
    @Matches(/^(?:[^\s@]+@[^\s@]+\.[^\s@]+|(?:0|\+84)[3|5|7|8|9][0-9]{8})$/, {
        message: VALIDATION_MESSAGES.EMAIL_OR_PHONE_INVALID,
    })
    @Transform(({ value }) =>
        typeof value === 'string' ? value.toLowerCase().trim() : value,
    )
    identifier: string;

    @IsNotEmpty({ message: VALIDATION_MESSAGES.PASSWORD_REQUIRED })
    password: string;
}
