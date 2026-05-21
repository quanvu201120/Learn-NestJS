/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Match } from '@/utils/decorator-customize';
import { IsEmail, IsNotEmpty } from 'class-validator';

export class CreateUserDto {
    @IsNotEmpty({ message: 'Tên không được để trống' })
    name: string;

    @IsNotEmpty({ message: 'Email không được để trống' })
    @IsEmail({}, { message: 'Email không đúng định dạng' })
    email: string;

    @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
    password: string;

    @IsNotEmpty({ message: 'Xác nhận mật khẩu không được để trống' })
    @Match('password', { message: 'Xác nhận mật khẩu không trùng khớp' })
    confirmPassword: string;

    @IsNotEmpty({ message: 'Số điện thoại không được để trống' })
    phone: string;
}
