import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';

export class SignInAuthDto {
    @IsEmail({}, { message: 'Email is invalid' })
    @IsNotEmpty({ message: 'Email is required' })
    email: string;

    @MinLength(6, { message: 'Password must be at least 6 characters' })
    @IsNotEmpty({ message: 'Password is required' })
    password: string;
}
