/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
    IsEmail,
    IsNotEmpty,
    IsOptional,
    IsString,
    IsIn,
    Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateUserDto {
    @IsOptional()
    @IsNotEmpty({ message: 'Name must not be empty' })
    @IsString({ message: 'Name must be a string' })
    name?: string;

    @IsOptional()
    @Transform(({ value }) => (value === '' ? null : value))
    @Matches(/^(0|\+84)(3|5|7|8|9)[0-9]{8}$/, {
        message: 'Số điện thoại không hợp lệ',
    })
    phone?: string | null;

    @IsOptional()
    @IsString({ message: 'Address must be a string' })
    address?: string | null;
}
export class UpdateUserByAdminDto {
    @IsOptional()
    @IsNotEmpty({ message: 'Name must not be empty' })
    @IsString({ message: 'Name must be a string' })
    name?: string;

    @IsOptional()
    @IsEmail({}, { message: 'Email must be a valid email' })
    @Transform(({ value }) =>
        typeof value === 'string' ? value.toLowerCase().trim() : value,
    )
    email?: string;

    @IsOptional()
    @Transform(({ value }) => (value === '' ? null : value))
    @Matches(/^(0|\+84)(3|5|7|8|9)[0-9]{8}$/, {
        message: 'Số điện thoại không hợp lệ',
    })
    phone?: string | null;

    @IsOptional()
    @IsString({ message: 'Address must be a string' })
    address?: string | null;

    @IsOptional()
    @IsIn(['USER', 'ADMIN'], { message: 'Role must be USER or ADMIN' })
    role?: string;
}
