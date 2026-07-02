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

@ValidatorConstraint({ name: 'isBeforeNow', async: false })
export class IsBeforeNowConstraint implements ValidatorConstraintInterface {
    validate(propertyValue: Date) {
        if (!propertyValue) return true;
        return propertyValue <= new Date();
    }

    defaultMessage() {
        return 'Date of birth cannot be in the future';
    }
}

export class UpdateUserDto {
    @IsOptional()
    @IsNotEmpty({ message: 'Name must not be empty' })
    @IsString({ message: 'Name must be a string' })
    name?: string;

    @IsOptional()
    @Transform(({ value }) => (value === '' ? null : value))
    @Matches(/^(0|\+84)(3|5|7|8|9)[0-9]{8}$/, {
        message: 'Invalid phone number',
    })
    phone?: string | null;

    @IsOptional()
    @IsString({ message: 'Address must be a string' })
    @MaxLength(150)
    address?: string | null;

    @IsOptional()
    @Transform(({ value }) => (value ? new Date(value) : value))
    @IsDate({ message: 'Invalid date of birth' })
    @Validate(IsBeforeNowConstraint)
    dateOfBirth?: Date | null;

    @IsOptional()
    @IsIn(Object.values(UserGenderEnum), { message: 'Invalid gender' })
    gender?: UserGenderEnum | null;

    @IsOptional()
    @IsString({ message: 'Bio must be a string' })
    @MaxLength(250)
    bio?: string | null;
}

export class UpdateRoleBySuperAdminDto {
    @IsNotEmpty({ message: 'Role must not be empty' })
    @IsIn([UserRole.USER, UserRole.ADMIN], {
        message: 'Role must be USER or ADMIN',
    })
    role: UserRole;

    @IsNotEmpty({ message: 'Password must not be empty' })
    @IsString()
    password: string;
}
