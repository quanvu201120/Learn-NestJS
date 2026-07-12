/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Match } from '@/utils/decorator-customize';
import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { VALIDATION_MESSAGES } from '@/common/constants/validation.constant';

export class ChangePasswordAuthDto {
    @MinLength(6, { message: VALIDATION_MESSAGES.OLD_PASSWORD_MIN_LENGTH })
    @IsNotEmpty({ message: VALIDATION_MESSAGES.OLD_PASSWORD_REQUIRED })
    passwordOld: string;

    @MinLength(6, { message: VALIDATION_MESSAGES.NEW_PASSWORD_MIN_LENGTH })
    @IsNotEmpty({ message: VALIDATION_MESSAGES.NEW_PASSWORD_REQUIRED })
    passwordNew: string;

    @MinLength(6, { message: VALIDATION_MESSAGES.CONFIRM_PASSWORD_MIN_LENGTH })
    @IsNotEmpty({ message: VALIDATION_MESSAGES.CONFIRM_PASSWORD_REQUIRED })
    @Match('passwordNew', {
        message: VALIDATION_MESSAGES.CONFIRM_PASSWORD_NOT_MATCH,
    })
    confirmPassword: string;
}

export class ForgotPasswordAuthDto {
    @IsEmail({}, { message: VALIDATION_MESSAGES.EMAIL_INVALID })
    @IsNotEmpty({ message: VALIDATION_MESSAGES.EMAIL_REQUIRED })
    @Transform(({ value }) =>
        typeof value === 'string' ? value.toLowerCase().trim() : value,
    )
    email: string;
}

export class ResetPasswordAuthDto {
    @IsNotEmpty({ message: VALIDATION_MESSAGES.EMAIL_REQUIRED })
    @IsEmail({}, { message: VALIDATION_MESSAGES.EMAIL_INVALID })
    @Transform(({ value }) =>
        typeof value === 'string' ? value.toLowerCase().trim() : value,
    )
    email: string;

    @IsNotEmpty({ message: VALIDATION_MESSAGES.CODE_REQUIRED })
    code: string;

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

export class ConfirmPasswordAuthDto {
    @MinLength(6, { message: VALIDATION_MESSAGES.PASSWORD_MIN_LENGTH })
    @IsNotEmpty({ message: VALIDATION_MESSAGES.PASSWORD_REQUIRED })
    password: string;
}

export class CreatePasswordAuthDto {
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
