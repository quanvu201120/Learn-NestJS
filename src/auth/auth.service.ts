/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { AUTH_MESSAGES, LOGIN_FAIL_POLICY } from './constants/auth.constant';
import { RedisService } from '@/redis/redis.service';
import { PayloadJWT } from '@/modules/users/schemas/user.schema';
import { UsersService } from '@/modules/users/users.service';
import { ReportsService } from '@/modules/reports/reports.service';
import {
    formatDateTime,
    generateJWT,
    hashRefreshToken,
    safeCompare,
    validateObjectId,
} from '@/utils/utils';
import {
    BadRequestException,
    ForbiddenException,
    HttpException,
    Injectable,
    InternalServerErrorException,
    UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectConnection } from '@nestjs/mongoose';
import bcrypt from 'bcrypt';
import { RegisterAuthDto } from './dto/register-auth.dto';
import {
    ChangePasswordAuthDto,
    CreatePasswordAuthDto,
    ResetPasswordAuthDto,
} from './dto/password-auth.dto';
import { SessionService } from '@/modules/session/session.service';
import { CreateSessionDto } from '@/modules/session/dto/create-session.dto';
import { StatsService } from '@/modules/stats/stats.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
    AuditLogActionEnum,
    AuditLogTargetEnum,
} from '@/modules/audit-log/types/audit-log.type';
import { UserResponse, UserRole } from '@/modules/users/types/user';
import { USER_MESSAGES } from '@/modules/users/constants/user.constant';
import { Connection, Types } from 'mongoose';
import { NotificationTypeEnum } from '@/modules/notifications/types/notification.type';
import { NOTIFICATION_TITLES } from '@/modules/notifications/constants/notification.constant';
import { PushSubscriptionsService } from '@/modules/push-subscriptions/push-subscriptions.service';

type LoginUser = UserResponse & {
    _id: string | Types.ObjectId;
    role: UserRole;
    tokenVersion: number;
    banUntil?: Date;
    isDisabled?: boolean;
    isActive?: boolean;
};

@Injectable()
export class AuthService {
    constructor(
        private readonly usersService: UsersService,
        private jwtService: JwtService,
        private configService: ConfigService,
        @InjectConnection()
        private readonly connection: Connection,
        private readonly sessionService: SessionService,
        private readonly statsService: StatsService,
        private readonly eventEmitter: EventEmitter2,
        private readonly reportsService: ReportsService,
        private readonly pushSubscriptionsService: PushSubscriptionsService,
        private readonly redisService: RedisService,
    ) {}

    /**
     * Redis key lưu số lần đăng nhập sai liên tiếp của một user (đếm trong `LOGIN_FAIL_POLICY.WINDOW_SECONDS`).
     */
    private getLoginFailKey(userId: string) {
        return `auth:login-fail:${userId}`;
    }

    /**
     * Redis key đánh dấu tài khoản đang bị chặn đăng nhập tạm thời; sự tồn tại + TTL của key quyết định thời gian chặn còn lại.
     */
    private getLoginBlockKey(userId: string) {
        return `auth:login-block:${userId}`;
    }

    /**
     * Nếu tài khoản đang bị chặn đăng nhập,  ném lỗi 429 kèm số phút còn lại
     */
    private async checkBlockedLoginFail(userId: string) {
        const ttlSeconds = await this.redisService.ttl(
            this.getLoginBlockKey(userId),
        );
        if (ttlSeconds > 0) {
            const minutes = Math.ceil(ttlSeconds / 60);
            throw new HttpException(
                AUTH_MESSAGES.LOGIN_TOO_MANY_ATTEMPTS(minutes),
                429,
            );
        }
    }

    /**
     * Ghi nhận một lần đăng nhập sai. Khi số lần sai tích luỹ chạm mốc trong
     * chính sách, đặt cờ chặn với thời gian tương ứng (càng sai càng lâu).
     */
    private async recordLoginFailure(userId: string) {
        const failCount = await this.redisService.incrWithTTL(
            this.getLoginFailKey(userId),
            LOGIN_FAIL_POLICY.WINDOW_SECONDS,
        );

        let blockSeconds = 0;
        for (const step of LOGIN_FAIL_POLICY.STEPS) {
            if (failCount >= step.threshold) {
                blockSeconds = step.blockSeconds;
            }
        }

        if (blockSeconds > 0) {
            await this.redisService.setWithTTL(
                this.getLoginBlockKey(userId),
                'blocked',
                blockSeconds,
            );
        }
    }

    /**
     * Xoá bộ đếm sai và cờ chặn khi đăng nhập thành công.
     */
    private async clearLoginFailures(userId: string) {
        await this.redisService.del(this.getLoginFailKey(userId));
        await this.redisService.del(this.getLoginBlockKey(userId));
    }

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
        if (user.hasPassword === false) {
            return null;
        }

        const userId = user._id.toString();
        await this.checkBlockedLoginFail(userId);

        const isPasswordMatched = await bcrypt.compare(pass, user.password);
        if (!isPasswordMatched) {
            await this.recordLoginFailure(userId);
            return null;
        }

        await this.clearLoginFailures(userId);

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { password, __v, ...result } = user.toObject();

        return result;
    }
    /**
     * Xử lý đăng nhập: Tạo phiên (Session), sinh JWT (Access Token & Refresh Token),
     * băm (hash) Refresh Token để lưu vào DB và trả về kết quả cho client.
     */
    /**
     * Xử lý đăng nhập.
     *
     * Nếu user đang bị ban, method không cấp access token mà trả về context
     * kháng cáo cho án ban hiện tại để FE điều hướng sang màn hình appeal.
     */
    async login(
        user: LoginUser,
        userAgent?: string,
        deviceName?: string,
        deviceId?: string,
    ) {
        if (user.banUntil && user.banUntil > new Date()) {
            return await this.buildBannedLoginResponse(user);
        }

        const deviceContext = await this.sessionService.resolveDeviceContext(
            user._id.toString(),
            deviceId,
        );
        let sessionId = '';
        try {
            const createSessionDto: CreateSessionDto = {
                userId: user._id.toString(),
                userAgent,
                deviceName,
                deviceId: deviceContext.deviceId,
            };
            const session = await this.sessionService.create(createSessionDto);
            sessionId = session._id.toString();
            const payload: PayloadJWT = {
                _id: user._id.toString(),
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

            if (deviceContext.isNewDevice) {
                this.eventEmitter.emit('notification.create', {
                    userId: user._id.toString(),
                    type: NotificationTypeEnum.LOGIN,
                    metadata: {
                        deviceName,
                        deviceId: deviceContext.deviceId,
                    },
                    title: NOTIFICATION_TITLES.LOGIN,
                });
            }

            this.statsService.incrementLogin();

            return {
                accessToken,
                refreshToken,
                user,
                deviceId: deviceContext.deviceId,
            };
        } catch (error) {
            if (sessionId) {
                await this.sessionService.revokeWithCleanup(
                    sessionId,
                    user._id.toString(),
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

    //Xử lý logic khi user bị ban
    private async buildBannedLoginResponse(user: LoginUser) {
        const appealContext =
            await this.reportsService.findCurrentAppealContextByUserId(
                user._id.toString(),
            );

        return {
            isBanned: true,
            banUntil: user.banUntil,
            appeal: appealContext
                ? {
                      reportId: appealContext.reportId,
                      reason: appealContext.reason,
                      status: appealContext.status,
                      appealDeadline: appealContext.appealDeadline,
                      appealReviewDeadline: appealContext.appealReviewDeadline,
                      penaltyApplied: appealContext.penaltyApplied,
                      penaltyType: appealContext.penaltyType,
                      appealToken:
                          appealContext.status === 'resolved' &&
                          appealContext.appealDeadline &&
                          new Date(appealContext.appealDeadline) > new Date()
                              ? await this.reportsService.generateAppealToken(
                                    user._id.toString(),
                                    appealContext.reportId,
                                )
                              : undefined,
                  }
                : undefined,
        };
    }

    /**
     * Đăng nhập bằng Google code, tự tìm hoặc tạo account theo email đã verify.
     */
    async googleLogin(
        code: string,
        userAgent?: string,
        deviceName?: string,
        deviceId?: string,
    ) {
        const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
        const clientSecret = this.configService.get<string>(
            'GOOGLE_CLIENT_SECRET',
        );
        const redirectUri = this.configService.get<string>(
            'GOOGLE_REDIRECT_URI',
        );

        if (!clientId || !clientSecret || !redirectUri) {
            throw new InternalServerErrorException(AUTH_MESSAGES.LOGIN_FAILED);
        }

        const tokenResponse = await fetch(
            'https://oauth2.googleapis.com/token',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    code,
                    client_id: clientId,
                    client_secret: clientSecret,
                    redirect_uri: redirectUri,
                    grant_type: 'authorization_code',
                }),
            },
        );

        if (!tokenResponse.ok) {
            throw new BadRequestException(AUTH_MESSAGES.LOGIN_FAILED);
        }

        const tokenData = (await tokenResponse.json()) as {
            id_token?: string;
        };

        if (!tokenData.id_token) {
            throw new BadRequestException(AUTH_MESSAGES.LOGIN_FAILED);
        }

        const verifyResponse = await fetch(
            `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(
                tokenData.id_token,
            )}`,
        );

        if (!verifyResponse.ok) {
            throw new BadRequestException(AUTH_MESSAGES.LOGIN_FAILED);
        }

        const googlePayload = (await verifyResponse.json()) as {
            email?: string;
            email_verified?: string | boolean;
            name?: string;
        };

        const email = googlePayload.email?.toLowerCase();
        const emailVerified =
            googlePayload.email_verified === true ||
            googlePayload.email_verified === 'true';

        if (!email || !emailVerified) {
            throw new BadRequestException(AUTH_MESSAGES.LOGIN_FAILED);
        }

        const existingUser = await this.usersService.findByEmailForLogin(email);
        const user: LoginUser = existingUser
            ? (() => {
                  // eslint-disable-next-line @typescript-eslint/no-unused-vars
                  const { password, __v, ...result } = existingUser.toObject();
                  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
                  return result as LoginUser;
              })()
            : await this.usersService.createGoogleAccount(
                  email,
                  googlePayload.name,
              );

        if (user.isDisabled) {
            throw new UnauthorizedException(AUTH_MESSAGES.USER_DISABLED);
        }
        if (user.isActive === false) {
            throw new ForbiddenException({
                message: USER_MESSAGES.USER_NOT_ACTIVE,
                email: user.email,
            });
        }
        if (user.banUntil && user.banUntil > new Date()) {
            return await this.buildBannedLoginResponse(user);
        }

        return await this.login(user, userAgent, deviceName, deviceId);
    }

    async getDevices(userId: string) {
        return await this.sessionService.getDevices(userId);
    }

    async removeDevice(userId: string, deviceId: string) {
        const session = await this.connection.startSession();
        try {
            let result: { deletedCount: number } = { deletedCount: 0 };

            await session.withTransaction(async () => {
                result = await this.sessionService.removeDevice(
                    userId,
                    deviceId,
                    session,
                );
                await this.pushSubscriptionsService.removeByDeviceId(
                    userId,
                    deviceId,
                    session,
                );
            });

            return result;
        } finally {
            await session.endSession();
        }
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
            if (user.banUntil && user.banUntil > new Date()) {
                await this.sessionService.revokeAllByUserIdWithCleanup(
                    payload._id,
                );
                const time = formatDateTime(user.banUntil);
                throw new UnauthorizedException(
                    AUTH_MESSAGES.ACCOUNT_BANNED_UNTIL(time),
                );
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

            if (!safeCompare(hashJwt, session.refreshTokenHash)) {
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
                AUTH_MESSAGES.LOGOUT_ALL_FAILED,
            );
        }
    }

    /**
     * Đăng xuất khỏi toàn bộ các thiết bị (Dành cho Admin).
     */
    async logoutAllDevicesByAdmin(
        userId: string,
        adminId: string,
        adminRole: UserRole,
        reason: string | undefined,
        req: any,
    ) {
        try {
            validateObjectId(userId, 'userId');
            validateObjectId(adminId, 'adminId');

            if (userId === adminId && adminRole !== UserRole.SUPER_ADMIN) {
                throw new BadRequestException(USER_MESSAGES.CAN_NOT_CHANGE_ME);
            }

            const { existingUser: user } = await this.usersService.checkUser(
                userId,
                false,
                false,
                false,
            );

            // Allow SUPER_ADMIN to logout anyone, ADMIN can logout USER, but not ADMIN/SUPER_ADMIN
            if (
                adminRole === UserRole.ADMIN &&
                (user.role === UserRole.ADMIN ||
                    user.role === UserRole.SUPER_ADMIN)
            ) {
                throw new ForbiddenException(AUTH_MESSAGES.MISSING_PERMISSION);
            }

            if (
                adminRole === UserRole.SUPER_ADMIN &&
                user.role === UserRole.SUPER_ADMIN &&
                userId !== adminId
            ) {
                throw new ForbiddenException(AUTH_MESSAGES.MISSING_PERMISSION);
            }

            user.tokenVersion += 1;
            await user.save();
            await this.sessionService.revokeAllByUserIdWithCleanup(userId);

            this.eventEmitter.emit('audit.log.create', {
                req,
                actorId: adminId,
                actorRole: adminRole,
                action: AuditLogActionEnum.FORCE_LOGOUT,
                targetId: userId,
                targetType: AuditLogTargetEnum.USER,
                metadata: { reason },
            });

            return {
                message: AUTH_MESSAGES.LOGOUT_ALL_SUCCESS,
            };
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            throw new InternalServerErrorException(
                AUTH_MESSAGES.LOGOUT_ALL_FAILED,
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
        currentSessionId: string,
    ) {
        return await this.usersService.updatePassword(
            id,
            changePasswordAuthDto,
            currentSessionId,
        );
    }

    /**
     * Tao mat khau lan dau cho tai khoan chua co local password.
     */
    async createPassword(
        id: string,
        createPasswordAuthDto: CreatePasswordAuthDto,
    ) {
        return await this.usersService.createPassword(
            id,
            createPasswordAuthDto,
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
