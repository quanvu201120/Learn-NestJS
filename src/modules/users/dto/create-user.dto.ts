/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Match } from '@/utils/decorator-customize';
import { Transform } from 'class-transformer';
import { UserRole } from '../types/user';
import {
    IsEmail,
    IsIn,
    IsNotEmpty,
    IsOptional,
    Matches,
} from 'class-validator';

export class CreateUserDto {
    @IsNotEmpty({ message: 'Tên không được để trống' })
    name: string;

    @IsNotEmpty({ message: 'Email không được để trống' })
    @IsEmail({}, { message: 'Email không đúng định dạng' })
    @Transform(({ value }) =>
        typeof value === 'string' ? value.toLowerCase().trim() : value,
    )
    email: string;

    @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
    password: string;

    @IsNotEmpty({ message: 'Xác nhận mật khẩu không được để trống' })
    @Match('password', { message: 'Xác nhận mật khẩu không trùng khớp' })
    confirmPassword: string;

    @IsOptional()
    @Transform(({ value }) => (value === '' ? null : value))
    @Matches(/^(0|\+84)(3|5|7|8|9)[0-9]{8}$/, {
        message: 'Số điện thoại không hợp lệ',
    })
    phone?: string;

    @IsOptional()
    address?: string;

    @IsOptional()
    @IsIn([UserRole.USER, UserRole.ADMIN], {
        message: 'Role phải là USER hoặc ADMIN',
    })
    role?: UserRole = UserRole.USER;
}
