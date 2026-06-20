/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Match } from '@/utils/decorator-customize';
import { Transform } from 'class-transformer';
import {
    IsEmail,
    IsIn,
    IsNotEmpty,
    IsOptional,
    IsPhoneNumber,
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
    @IsPhoneNumber('VN')
    phone?: string;

    @IsOptional()
    address?: string;

    @IsOptional()
    @IsIn(['USER', 'ADMIN'], { message: 'Role phải là USER hoặc ADMIN' })
    role?: string = 'USER';
}
