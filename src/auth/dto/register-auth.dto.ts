/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Match } from '@/utils/decorator-customize';
import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class RegisterAuthDto {
    @IsEmail({}, { message: 'Email is invalid' })
    @IsNotEmpty({ message: 'Email is required' })
    @Transform(({ value }) =>
        typeof value === 'string' ? value.toLowerCase().trim() : value,
    )
    email: string;

    @MinLength(6, { message: 'Password must be at least 6 characters' })
    @IsNotEmpty({ message: 'Password is required' })
    password: string;

    @MinLength(6, { message: 'Confirm Password must be at least 6 characters' })
    @IsNotEmpty({ message: 'Confirm Password is required' })
    @Match('password', { message: 'Confirm Password does not match' })
    confirmPassword: string;
}

export class LoginDto {
    @IsEmail({}, { message: 'Email is invalid' })
    @IsNotEmpty({ message: 'Email is required' })
    @Transform(({ value }) =>
        typeof value === 'string' ? value.toLowerCase().trim() : value,
    )
    email: string;

    @IsNotEmpty({ message: 'Password is required' })
    password: string;
}
