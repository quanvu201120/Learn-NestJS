/* eslint-disable @typescript-eslint/no-unsafe-return */
import { IsEmail, IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';
import { VALIDATION_MESSAGES } from '@/common/constants/validation.constant';

export class ActiveAuthDto {
    @IsEmail({}, { message: VALIDATION_MESSAGES.EMAIL_INVALID })
    @IsNotEmpty({ message: VALIDATION_MESSAGES.EMAIL_REQUIRED })
    @Transform(({ value }) =>
        typeof value === 'string' ? value.toLowerCase().trim() : value,
    )
    email: string;

    @IsNotEmpty({ message: VALIDATION_MESSAGES.CODE_INVALID })
    code: string;
}

export class ResendCodeAuthDto {
    @IsEmail({}, { message: VALIDATION_MESSAGES.EMAIL_INVALID })
    @IsNotEmpty({ message: VALIDATION_MESSAGES.EMAIL_REQUIRED })
    @Transform(({ value }) =>
        typeof value === 'string' ? value.toLowerCase().trim() : value,
    )
    email: string;
}

export class SendCodeUpdateEmailAuthDto {
    @IsEmail({}, { message: VALIDATION_MESSAGES.EMAIL_INVALID })
    @IsNotEmpty({ message: VALIDATION_MESSAGES.EMAIL_REQUIRED })
    @Transform(({ value }) =>
        typeof value === 'string' ? value.toLowerCase().trim() : value,
    )
    email: string;
}

export class UpdateEmailAuthDto {
    @IsEmail({}, { message: VALIDATION_MESSAGES.EMAIL_INVALID })
    @IsNotEmpty({ message: VALIDATION_MESSAGES.EMAIL_REQUIRED })
    @Transform(({ value }) =>
        typeof value === 'string' ? value.toLowerCase().trim() : value,
    )
    email: string;

    @IsNotEmpty({ message: VALIDATION_MESSAGES.CODE_INVALID })
    code: string;
}
