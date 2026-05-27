/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { PayloadJWT } from '@/modules/users/schemas/user.schema';
import { UsersService } from '@/modules/users/users.service';
import { generateJWT } from '@/utils/utils';
import {
    HttpException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { RegisterAuthDto } from './dto/register-auth.dto';
import {
    ChangePasswordAuthDto,
    ResetPasswordAuthDto,
} from './dto/password-auth.dto';

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
        const payload: PayloadJWT = { _id: user._id, role: user.role };
        const { accessToken, refreshToken } = await generateJWT(
            payload,
            this.configService,
            this.jwtService,
        );

        await this.usersService.updateRefreshToken(refreshToken, user._id);

        return {
            accessToken,
            refreshToken,
            user,
            message: 'Đăng nhập thành công',
        };
    }

    async register(registerAuthDto: RegisterAuthDto) {
        const { email, password } = registerAuthDto;
        return await this.usersService.register(email, password);
    }

    async refreshToken(refreshTokenOld: string) {
        if (!refreshTokenOld) {
            throw new UnauthorizedException('Không tìm thấy Refresh Token');
        }
        try {
            const payload: PayloadJWT = await this.jwtService.verifyAsync(
                refreshTokenOld,
                {
                    secret: this.configService.get<string>(
                        'JWT_REFRESH_SECRET',
                    ),
                },
            );

            const user = await this.usersService.findOne(payload._id);
            if (!user) {
                throw new UnauthorizedException('Token không hợp lệ');
            }

            const isRefreshTokenExist = user.refreshTokens.some(
                (item) => item.token === String(refreshTokenOld),
            );

            if (isRefreshTokenExist === false) {
                throw new UnauthorizedException(
                    'Refresh Token không hợp lệ hoặc đã được sử dụng',
                );
            }

            const { accessToken, refreshToken } = await generateJWT(
                payload,
                this.configService,
                this.jwtService,
            );

            await this.usersService.removeRefreshToken(
                refreshTokenOld,
                payload._id,
            );
            await this.usersService.updateRefreshToken(
                refreshToken,
                payload._id,
            );
            return { accessToken, refreshToken };
        } catch (error: any) {
            if (error.name === 'TokenExpiredError') {
                try {
                    const decoded: PayloadJWT =
                        this.jwtService.decode(refreshTokenOld);
                    if (decoded && decoded._id) {
                        await this.usersService.removeRefreshToken(
                            refreshTokenOld,
                            decoded._id,
                        );
                    }
                } catch (cleanupError) {
                    console.error('Lỗi dọn dẹp token hết hạn:', cleanupError);
                }
            }

            if (error instanceof HttpException) {
                throw error;
            }
            console.error('Error during token refresh:', error);
            throw new UnauthorizedException(
                'Refresh Token không hợp lệ hoặc đã hết hạn',
            );
        }
    }

    async logout(refreshToken: string, id: string) {
        return await this.usersService.removeRefreshToken(refreshToken, id);
    }

    async activateUser(email: string, code: string) {
        return await this.usersService.activateUser(email, code);
    }

    async reSendCodeActive(email: string) {
        return await this.usersService.reSendCodeActive(email);
    }

    async changePassword(
        id: string,
        changePasswordAuthDto: ChangePasswordAuthDto,
    ) {
        return await this.usersService.updatePassword(
            id,
            changePasswordAuthDto,
        );
    }

    async forgotPassword(email: string) {
        return await this.usersService.sendMailForgotPassword(email);
    }
    async resetPassword(resetPasswordAuthDto: ResetPasswordAuthDto) {
        const { email, code, password } = resetPasswordAuthDto;

        return await this.usersService.resetPassword(email, code, password);
    }
}
