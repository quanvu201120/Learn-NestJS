/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { PayloadJWT, User } from '@/modules/users/schemas/user.schema';
import { UsersService } from '@/modules/users/users.service';
import { generateJWT, hashRefreshToken } from '@/utils/utils';
import {
    HttpException,
    Injectable,
    InternalServerErrorException,
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
import { SessionService } from '@/modules/session/session.service';
import { CreateSessionDto } from '@/modules/session/dto/create-session.dto';

@Injectable()
export class AuthService {
    constructor(
        private readonly usersService: UsersService,
        private jwtService: JwtService,
        private configService: ConfigService,
        private readonly sessionService: SessionService,
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
    async login(
        user: User & { _id: string },
        userAgent?: string,
        deviceName?: string,
    ) {
        let sessionId = '';
        try {
            const createSessionDto: CreateSessionDto = {
                userId: user._id,
                userAgent,
                deviceName,
            };
            const session = await this.sessionService.create(createSessionDto);
            sessionId = session._id.toString();
            const payload: PayloadJWT = {
                _id: user._id,
                role: user.role,
                sessionId,
                tokenVersion: user.tokenVersion,
            };
            const { accessToken, refreshToken, expireDate } = await generateJWT(
                payload,
                this.configService,
                this.jwtService,
            );
            const hashRefreshJWT = hashRefreshToken(
                refreshToken,
                this.configService.get<string>('REFRESH_TOKEN_PEPPER')!,
            );

            await this.sessionService.rotateSession(
                session._id.toString(),
                hashRefreshJWT,
                expireDate,
            );

            return {
                accessToken,
                refreshToken,
                user,
                message: 'Đăng nhập thành công',
            };
        } catch (error) {
            if (sessionId) {
                await this.sessionService.revoke(sessionId, user._id);
            }
            console.log(error);

            throw new InternalServerErrorException('Đăng nhập thất bại!');
        }
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
                throw new UnauthorizedException('Không tìm thấy người dùng');
            }

            if (payload.tokenVersion !== user.tokenVersion) {
                await this.sessionService.revokeAllByUserId(payload._id);
                throw new UnauthorizedException('Token không hợp lệ');
            }

            const session = await this.sessionService.findSessionById(
                payload.sessionId,
            );

            if (!session) {
                throw new UnauthorizedException('Session không tồn tại');
            }

            if (session.isRevoked === true) {
                throw new UnauthorizedException('Session đã bị thu hồi');
            }

            if (session.expiresAt && session.expiresAt < new Date()) {
                await this.sessionService.revoke(
                    session._id.toString(),
                    payload._id,
                );
                throw new UnauthorizedException('Session đã hết hạn');
            }

            if (session.userId.toString() !== payload._id) {
                throw new UnauthorizedException('Token không hợp lệ');
            }
            const hashJwt = hashRefreshToken(
                refreshTokenOld,
                this.configService.get<string>('REFRESH_TOKEN_PEPPER')!,
            );

            if (hashJwt !== session.refreshTokenHash) {
                throw new UnauthorizedException(
                    'Refresh Token không hợp lệ hoặc đã được sử dụng',
                );
            }

            const { accessToken, refreshToken, expireDate } = await generateJWT(
                payload,
                this.configService,
                this.jwtService,
            );

            const hashJwtNew = hashRefreshToken(
                refreshToken,
                this.configService.get<string>('REFRESH_TOKEN_PEPPER')!,
            );

            await this.sessionService.rotateSession(
                session._id.toString(),
                hashJwtNew,
                expireDate,
            );
            return { accessToken, refreshToken };
        } catch (error: any) {
            if (error.name === 'TokenExpiredError') {
                try {
                    const decoded: PayloadJWT =
                        this.jwtService.decode(refreshTokenOld);
                    if (decoded && decoded._id) {
                        await this.sessionService.revoke(
                            decoded.sessionId,
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

    async logout(refreshToken: string, userId: string) {
        if (!refreshToken) {
            return null;
        }

        try {
            const payload: PayloadJWT = await this.jwtService.verifyAsync(
                refreshToken,
                {
                    secret: this.configService.get<string>(
                        'JWT_REFRESH_SECRET',
                    ),
                },
            );

            if (payload._id !== userId) {
                throw new UnauthorizedException('Token không hợp lệ');
            }

            await this.sessionService.revoke(payload.sessionId, userId);
            return null;
        } catch (error) {
            console.log(error);
            return null;
        }
    }

    async logoutAllDevices(userId: string) {
        try {
            const user = await this.usersService.findOne(userId);
            if (!user) {
                throw new UnauthorizedException('Không tìm thấy người dùng');
            }
            user.tokenVersion += 1;
            await user.save();
            await this.sessionService.revokeAllByUserId(userId);
            return {
                message: 'Đăng xuất tất cả các thiết bị thành công',
            };
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (error) {
            throw new InternalServerErrorException(
                'Đăng xuất tất cả các thiết bị thất bại',
            );
        }
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
