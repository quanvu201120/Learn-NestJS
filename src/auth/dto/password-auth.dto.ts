import { Match } from '@/utils/decorator-customize';
import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';

export class ChangePasswordAuthDto {
    @MinLength(6, { message: 'Old password must be at least 6 characters' })
    @IsNotEmpty({ message: 'Old password is required' })
    passwordOld: string;

    @MinLength(6, { message: 'New password must be at least 6 characters' })
    @IsNotEmpty({ message: 'New password is required' })
    passwordNew: string;

    @MinLength(6, { message: 'Confirm password must be at least 6 characters' })
    @IsNotEmpty({ message: 'Confirm password is required' })
    @Match('passwordNew', { message: 'Confirm password does not match' })
    confirmPassword: string;
}

export class ForgotPasswordAuthDto {
    @IsEmail({}, { message: 'Email không đúng định dạng' })
    @IsNotEmpty({ message: 'Email không được để trống' })
    email: string;
}

export class ResetPasswordAuthDto {
    @IsNotEmpty({ message: 'Email không được để trống' })
    @IsEmail({}, { message: 'Email không đúng định dạng' })
    email: string;

    @IsNotEmpty({ message: 'Code không được để trống' })
    code: string;

    @MinLength(6, { message: 'Mật khẩu phải có ít nhất 6 ký tự' })
    @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
    password: string;

    @MinLength(6, { message: 'Xác nhận mật khẩu phải có ít nhất 6 ký tự' })
    @IsNotEmpty({ message: 'Xác nhận mật khẩu không được để trống' })
    @Match('password', { message: 'Xác nhận mật khẩu không khớp' })
    confirmPassword: string;
}
