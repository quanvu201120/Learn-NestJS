/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
    IsNotEmpty,
    IsOptional,
    IsString,
    IsIn,
    Matches,
    IsDate,
    ValidatorConstraint,
    ValidatorConstraintInterface,
    Validate,
    MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { UserGenderEnum, UserRole } from '../types/user';
import { VALIDATION_MESSAGES } from '@/common/constants/validation.constant';

@ValidatorConstraint({ name: 'isBeforeNow', async: false })
export class IsBeforeNowConstraint implements ValidatorConstraintInterface {
    validate(propertyValue: Date) {
        if (!propertyValue) return true;
        return propertyValue <= new Date();
    }

    defaultMessage() {
        return VALIDATION_MESSAGES.DATE_OF_BIRTH_FUTURE;
    }
}

export class UpdateUserDto {
    @IsOptional()
    @IsNotEmpty({ message: VALIDATION_MESSAGES.NAME_REQUIRED })
    @IsString({ message: VALIDATION_MESSAGES.NAME_STRING })
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @MaxLength(50)
    name?: string;

    @IsOptional()
    @Transform(({ value }) => (value === '' ? null : value))
    @Matches(/^(0|\+84)(3|5|7|8|9)[0-9]{8}$/, {
        message: VALIDATION_MESSAGES.PHONE_INVALID,
    })
    phone?: string | null;

    @IsOptional()
    @IsString({ message: VALIDATION_MESSAGES.ADDRESS_STRING })
    @MaxLength(150)
    address?: string | null;

    @IsOptional()
    @Transform(({ value }) => (value ? new Date(value) : value))
    @IsDate({ message: VALIDATION_MESSAGES.DATE_OF_BIRTH_INVALID })
    @Validate(IsBeforeNowConstraint)
    dateOfBirth?: Date | null;

    @IsOptional()
    @IsIn(Object.values(UserGenderEnum), {
        message: VALIDATION_MESSAGES.GENDER_INVALID,
    })
    gender?: UserGenderEnum | null;

    @IsOptional()
    @IsString({ message: VALIDATION_MESSAGES.BIO_STRING })
    @MaxLength(250)
    bio?: string | null;
}

export class AdminActionReasonDto {
    @IsNotEmpty({ message: VALIDATION_MESSAGES.REASON_REQUIRED })
    @IsString({ message: VALIDATION_MESSAGES.REASON_STRING })
    @Transform(({ value }) =>
        typeof value === 'number' ? String(value) : value,
    )
    reason: string;
}

export class UpdateRoleBySuperAdminDto {
    @IsNotEmpty({ message: VALIDATION_MESSAGES.ROLE_REQUIRED })
    @IsIn([UserRole.USER, UserRole.ADMIN], {
        message: VALIDATION_MESSAGES.ROLE_INVALID,
    })
    role: UserRole;

    @IsNotEmpty({ message: VALIDATION_MESSAGES.PASSWORD_REQUIRED })
    @IsString()
    password: string;

    @IsOptional()
    @IsString({ message: VALIDATION_MESSAGES.REASON_STRING })
    @Transform(({ value }) =>
        typeof value === 'number' ? String(value) : value,
    )
    reason?: string;
}

export class AdminActionWithPasswordDto extends AdminActionReasonDto {
    @IsNotEmpty({ message: VALIDATION_MESSAGES.PASSWORD_REQUIRED })
    @IsString()
    password: string;
}
