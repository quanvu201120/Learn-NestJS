/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { UsersService } from '@/modules/users/users.service';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { StringValue } from 'ms';

@Injectable()
export class AuthService {
    constructor(
        private readonly usersService: UsersService,
        private jwtService: JwtService,
        private configService: ConfigService,
    ) {}

    async validateUser(email: string, pass: string) {
        const user = await this.usersService.findByEmail(email);
        if (!user) {
            return null;
        }
        const isPasswordMatched = await bcrypt.compare(pass, user.password);
        if (!isPasswordMatched) {
            return null;
        }

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { password, __v, ...result } = user.toObject();

        return result;
    }
    async login(user: any) {
        const payload = { _id: user._id, role: user.role };
        const accessToken = await this.jwtService.signAsync(payload);
        const refreshToken = await this.jwtService.signAsync(payload, {
            secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
            expiresIn: this.configService.get<StringValue>(
                'JWT_REFRESH_EXPIRES_IN',
            ),
        });
        return {
            accessToken,
            refreshToken,
            user,
            message: 'Đăng nhập thành công',
        };
    }
}
