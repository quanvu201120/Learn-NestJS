/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { AUTH_MESSAGES } from './constants/auth.constant';
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
import { StatsService } from '@/modules/stats/stats.service';

@Injectable()
export class AuthService {
    constructor(
        private readonly usersService: UsersService,
        private jwtService: JwtService,
        private configService: ConfigService,
        private readonly sessionService: SessionService,
        private readonly statsService: StatsService,
    ) {}

    /**
     * Xác thực thông tin đăng nhập của user (email/sdt và password).
     * Trả về thông tin user (đã loại bỏ password) nếu hợp lệ, ngược lại trả về null.
     */
    async validateUser(identifier: string, pass: string) {
        const user =
            await this.usersService.findByEmailOrPhoneForLogin(identifier);
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
    /**
     * Xử lý đăng nhập: Tạo phiên (Session), sinh JWT (Access Token & Refresh Token),
     * băm (hash) Refresh Token để lưu vào DB và trả về kết quả cho client.
     */
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

            this.statsService.incrementLogin();

            return {
                accessToken,
                refreshToken,
                user,
            };
        } catch (error) {
            if (sessionId) {
                await this.sessionService.revokeWithCleanup(
                    sessionId,
                    user._id,
                );
            }
            console.log(error);

            throw new InternalServerErrorException(AUTH_MESSAGES.LOGIN_FAILED);
        }
    }

    /**
     * Chuyển tiếp logic đăng ký tài khoản sang UsersService.
     */
    async register(registerAuthDto: RegisterAuthDto) {
        const { email, password } = registerAuthDto;
        return await this.usersService.register(email, password);
    }

    /**
     * Cấp mới Access Token bằng Refresh Token (Token Rotation).
     * Kiểm tra tính hợp lệ của Refresh Token, Session, và Token Version để đảm bảo bảo mật.
     */
    async refreshToken(refreshTokenOld: string) {
        if (!refreshTokenOld) {
            throw new UnauthorizedException(
                AUTH_MESSAGES.REFRESH_TOKEN_NOT_FOUND,
            );
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
                throw new UnauthorizedException(AUTH_MESSAGES.USER_NOT_FOUND);
            }
            if (user.isDisabled) {
                await this.sessionService.revokeAllByUserIdWithCleanup(
                    payload._id,
                );
                throw new UnauthorizedException(AUTH_MESSAGES.USER_DISABLED);
            }

            if (payload.tokenVersion !== user.tokenVersion) {
                await this.sessionService.revokeAllByUserIdWithCleanup(
                    payload._id,
                );
                throw new UnauthorizedException(AUTH_MESSAGES.INVALID_TOKEN);
            }

            const session = await this.sessionService.findSessionById(
                payload.sessionId,
            );

            if (!session) {
                throw new UnauthorizedException(
                    AUTH_MESSAGES.SESSION_NOT_FOUND,
                );
            }

            if (session.isRevoked === true) {
                throw new UnauthorizedException(AUTH_MESSAGES.SESSION_REVOKED);
            }

            if (session.expiresAt && session.expiresAt < new Date()) {
                await this.sessionService.revokeWithCleanup(
                    session._id.toString(),
                    payload._id,
                );
                throw new UnauthorizedException(AUTH_MESSAGES.SESSION_EXPIRED);
            }

            if (session.userId.toString() !== payload._id) {
                throw new UnauthorizedException(AUTH_MESSAGES.INVALID_TOKEN);
            }
            const hashJwt = hashRefreshToken(
                refreshTokenOld,
                this.configService.get<string>('REFRESH_TOKEN_PEPPER')!,
            );

            if (hashJwt !== session.refreshTokenHash) {
                throw new UnauthorizedException(
                    AUTH_MESSAGES.INVALID_REFRESH_TOKEN,
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
                        await this.sessionService.revokeWithCleanup(
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
                AUTH_MESSAGES.EXPIRED_REFRESH_TOKEN,
            );
        }
    }

    /**
     * Đăng xuất trên thiết bị hiện tại (hủy Session tương ứng).
     */
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
                throw new UnauthorizedException(AUTH_MESSAGES.INVALID_TOKEN);
            }

            await this.sessionService.revokeWithCleanup(
                payload.sessionId,
                userId,
            );
            return null;
        } catch (error) {
            console.log(error);
            return null;
        }
    }

    /**
     * Đăng xuất khỏi toàn bộ các thiết bị (Tăng tokenVersion và hủy toàn bộ Session của user).
     */
    async logoutAllDevices(userId: string) {
        try {
            const user = await this.usersService.findOne(userId);
            if (!user) {
                throw new UnauthorizedException(AUTH_MESSAGES.USER_NOT_FOUND);
            }
            if (user.isDisabled) {
                throw new UnauthorizedException(AUTH_MESSAGES.USER_DISABLED);
            }
            user.tokenVersion += 1;
            await user.save();
            await this.sessionService.revokeAllByUserIdWithCleanup(userId);
            return {
                message: AUTH_MESSAGES.LOGOUT_ALL_SUCCESS,
            };
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (error) {
            throw new InternalServerErrorException(
                'Đăng xuất tất cả các thiết bị thất bại',
            );
        }
    }

    /**
     * Kích hoạt tài khoản người dùng bằng mã OTP.
     */
    async activateUser(email: string, code: string) {
        return await this.usersService.activateUser(email, code);
    }

    /**
     * Gửi lại mã OTP kích hoạt tài khoản.
     */
    async reSendCodeActive(email: string) {
        return await this.usersService.reSendCodeActive(email);
    }

    /**
     * Thay đổi mật khẩu khi người dùng đã đăng nhập (cần mật khẩu cũ).
     */
    async changePassword(
        id: string,
        changePasswordAuthDto: ChangePasswordAuthDto,
    ) {
        return await this.usersService.updatePassword(
            id,
            changePasswordAuthDto,
        );
    }

    /**
     * Gửi mã OTP khôi phục mật khẩu vào email.
     */
    async forgotPassword(email: string) {
        return await this.usersService.sendMailForgotPassword(email);
    }

    /**
     * Đặt lại mật khẩu mới thông qua mã OTP khôi phục.
     */
    async resetPassword(resetPasswordAuthDto: ResetPasswordAuthDto) {
        const { email, code, password } = resetPasswordAuthDto;

        return await this.usersService.resetPassword(email, code, password);
    }
}
