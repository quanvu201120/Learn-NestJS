/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
    IsEmail,
    IsNotEmpty,
    IsOptional,
    IsString,
    IsIn,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateUserDto {
    @IsOptional()
    @IsNotEmpty({ message: 'Name must not be empty' })
    @IsString({ message: 'Name must be a string' })
    name?: string;

    @IsOptional()
    @IsString({ message: 'Phone must be a string' })
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
    @IsString({ message: 'Phone must be a string' })
    phone?: string | null;

    @IsOptional()
    @IsString({ message: 'Address must be a string' })
    address?: string | null;

    @IsOptional()
    @IsIn(['USER', 'ADMIN'], { message: 'Role must be USER or ADMIN' })
    role?: string;
}
