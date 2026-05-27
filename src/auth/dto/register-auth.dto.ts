import { Match } from '@/utils/decorator-customize';
import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';

export class RegisterAuthDto {
    @IsEmail({}, { message: 'Email is invalid' })
    @IsNotEmpty({ message: 'Email is required' })
    email: string;

    @MinLength(6, { message: 'Password must be at least 6 characters' })
    @IsNotEmpty({ message: 'Password is required' })
    password: string;

    @MinLength(6, { message: 'Confirm Password must be at least 6 characters' })
    @IsNotEmpty({ message: 'Confirm Password is required' })
    @Match('password', { message: 'Confirm Password does not match' })
    confirmPassword: string;
}

export class ActiveAuthDto {
    @IsEmail({}, { message: 'Email is invalid' })
    @IsNotEmpty({ message: 'Email is required' })
    email: string;

    @IsNotEmpty({ message: 'Code is invalid' })
    code: string;
}

export class ResendCodeAuthDto {
    @IsEmail({}, { message: 'Email không đúng định dạng' })
    @IsNotEmpty({ message: 'Email không được để trống' })
    email: string;
}

export class LoginDto {
    @IsEmail({}, { message: 'Email is invalid' })
    @IsNotEmpty({ message: 'Email is required' })
    email: string;

    @IsNotEmpty({ message: 'Password is required' })
    password: string;
}
