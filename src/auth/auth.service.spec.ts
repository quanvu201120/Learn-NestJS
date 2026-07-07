import {
    HttpException,
    InternalServerErrorException,
    UnauthorizedException,
} from '@nestjs/common';
import bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { UsersService } from '@/modules/users/users.service';
import { SessionService } from '@/modules/session/session.service';
import { RegisterAuthDto } from './dto/register-auth.dto';
import {
    ChangePasswordAuthDto,
    ResetPasswordAuthDto,
} from './dto/password-auth.dto';
import { generateJWT, hashRefreshToken } from '@/utils/utils';

jest.mock('api-query-params', () => ({
    __esModule: true,
    default: jest.fn(),
}));

jest.mock('uuid', () => ({
    __esModule: true,
    v4: jest.fn(() => 'mock-uuid'),
}));

jest.mock('bcrypt', () => ({
    __esModule: true,
    default: {
        compare: jest.fn(),
    },
}));

jest.mock('@/utils/utils', () => ({
    __esModule: true,
    generateJWT: jest.fn(),
    hashRefreshToken: jest.fn(),
}));

type MockUserObject = {
    _id: string;
    email: string;
    password?: string;
    role: string;
    tokenVersion: number;
    toObject?: jest.Mock;
    save?: jest.Mock;
};

type MockSession = {
    _id: Types.ObjectId | string;
    userId: Types.ObjectId | string;
    isRevoked?: boolean;
    expiresAt?: Date;
    refreshTokenHash?: string;
};

describe('AuthService', () => {
    let service: AuthService;
    let usersService: jest.Mocked<UsersService>;
    let jwtService: jest.Mocked<JwtService>;
    let configService: jest.Mocked<ConfigService>;
    let sessionService: jest.Mocked<SessionService>;

    const userId = new Types.ObjectId().toString();
    const sessionId = new Types.ObjectId().toString();
    const refreshToken = 'refresh-token';

    const mockedBcryptCompare = bcrypt.compare as jest.MockedFunction<
        typeof bcrypt.compare
    >;
    const mockedGenerateJWT = generateJWT as jest.MockedFunction<
        typeof generateJWT
    >;
    const mockedHashRefreshToken = hashRefreshToken as jest.MockedFunction<
        typeof hashRefreshToken
    >;

    const createUser = (
        overrides: Partial<MockUserObject> = {},
    ): MockUserObject => ({
        _id: userId,
        email: 'quan@example.com',
        password: 'hashed-password',
        role: 'USER',
        tokenVersion: 0,
        toObject: jest.fn(function (this: MockUserObject) {
            return { ...this, __v: 0 };
        }),
        save: jest.fn().mockResolvedValue(undefined),
        ...overrides,
    });

    beforeEach(() => {
        usersService = {
            findByEmail: jest.fn(),
            findOne: jest.fn(),
            register: jest.fn(),
            activateUser: jest.fn(),
            reSendCodeActive: jest.fn(),
            updatePassword: jest.fn(),
            sendMailForgotPassword: jest.fn(),
            resetPassword: jest.fn(),
        } as unknown as jest.Mocked<UsersService>;

        jwtService = {
            verifyAsync: jest.fn(),
            decode: jest.fn(),
        } as unknown as jest.Mocked<JwtService>;

        configService = {
            get: jest.fn((key: string) => {
                const map: Record<string, string> = {
                    REFRESH_TOKEN_PEPPER: 'pepper',
                    JWT_REFRESH_SECRET: 'refresh-secret',
                };
                return map[key];
            }),
        } as unknown as jest.Mocked<ConfigService>;

        sessionService = {
            create: jest.fn(),
            rotateSession: jest.fn(),
            revoke: jest.fn(),
            revokeAllByUserId: jest.fn(),
            findSessionById: jest.fn(),
        } as unknown as jest.Mocked<SessionService>;

        service = new AuthService(
            usersService,
            jwtService,
            configService,
            sessionService,
        );

        mockedBcryptCompare.mockReset();
        mockedGenerateJWT.mockReset();
        mockedHashRefreshToken.mockReset();
    });

    describe('validateUser', () => {
        it('Case: xác thực user thành công khi email tồn tại và password đúng', async () => {
            const user = createUser();
            usersService.findByEmail.mockResolvedValue(user);
            mockedBcryptCompare.mockResolvedValue(true as never);

            const result = await service.validateUser(
                user.email,
                'plain-password',
            );

            expect(usersService.findByEmail).toHaveBeenCalledWith(user.email);
            expect(mockedBcryptCompare).toHaveBeenCalledWith(
                'plain-password',
                user.password,
            );
            expect(result).toMatchObject({
                _id: user._id,
                email: user.email,
            });
            expect(result).not.toHaveProperty('password');
        });

        it('Case: xác thực user thất bại khi không tìm thấy email', async () => {
            usersService.findByEmail.mockResolvedValue(null);

            const result = await service.validateUser(
                'missing@example.com',
                'plain-password',
            );

            expect(result).toBeNull();
        });

        it('Case: xác thực user thất bại khi password không đúng', async () => {
            const user = createUser();
            usersService.findByEmail.mockResolvedValue(user);
            mockedBcryptCompare.mockResolvedValue(false as never);

            const result = await service.validateUser(
                user.email,
                'wrong-password',
            );

            expect(result).toBeNull();
        });
    });

    describe('login', () => {
        it('Case: đăng nhập thành công và tạo session mới', async () => {
            const user = createUser();
            const expireDate = new Date();
            sessionService.create.mockResolvedValue({
                _id: new Types.ObjectId(sessionId),
            } as never);
            mockedGenerateJWT.mockResolvedValue({
                accessToken: 'access-token',
                refreshToken,
                expireDate,
            });
            mockedHashRefreshToken.mockReturnValue('hashed-refresh');
            sessionService.rotateSession.mockResolvedValue({} as never);

            const result = await service.login(
                user as never,
                'Chrome',
                'Laptop',
            );

            expect(sessionService.create).toHaveBeenCalledWith({
                userId: user._id,
                userAgent: 'Chrome',
                deviceName: 'Laptop',
            });
            expect(mockedGenerateJWT).toHaveBeenCalled();
            expect(mockedHashRefreshToken).toHaveBeenCalledWith(
                refreshToken,
                'pepper',
            );
            expect(sessionService.rotateSession).toHaveBeenCalledWith(
                sessionId,
                'hashed-refresh',
                expireDate,
            );
            expect(result).toEqual({
                accessToken: 'access-token',
                refreshToken,
                user,
                message: 'Đăng nhập thành công',
            });
        });

        it('Case: đăng nhập thất bại thì revoke session đã tạo và ném lỗi nội bộ', async () => {
            const user = createUser();
            sessionService.create.mockResolvedValue({
                _id: new Types.ObjectId(sessionId),
            } as never);
            mockedGenerateJWT.mockRejectedValue(new Error('jwt failed'));
            sessionService.revoke.mockResolvedValue({} as never);

            await expect(service.login(user as never)).rejects.toThrow(
                InternalServerErrorException,
            );
            expect(sessionService.revoke).toHaveBeenCalledWith(
                sessionId,
                user._id,
            );
        });
    });

    describe('register', () => {
        it('Case: đăng ký tài khoản sẽ gọi usersService.register đúng email và password', async () => {
            const dto: RegisterAuthDto = {
                email: 'quan@example.com',
                password: '123456',
                confirmPassword: '123456',
            };
            usersService.register.mockResolvedValue({ ok: true } as never);

            const result = await service.register(dto);

            expect(usersService.register).toHaveBeenCalledWith(
                dto.email,
                dto.password,
            );
            expect(result).toEqual({ ok: true });
        });
    });

    describe('refreshToken', () => {
        it('Case: làm mới token thành công khi refresh token, user và session đều hợp lệ', async () => {
            const payload = {
                _id: userId,
                role: 'USER',
                sessionId,
                tokenVersion: 0,
            };
            const user = createUser({ tokenVersion: 0 });
            const session: MockSession = {
                _id: new Types.ObjectId(sessionId),
                userId: new Types.ObjectId(userId),
                isRevoked: false,
                expiresAt: new Date(Date.now() + 60_000),
                refreshTokenHash: 'old-hash',
            };
            const expireDate = new Date(Date.now() + 120_000);

            jwtService.verifyAsync.mockResolvedValue(payload);
            usersService.findOne.mockResolvedValue(user as never);
            sessionService.findSessionById.mockResolvedValue(session as never);
            mockedHashRefreshToken
                .mockReturnValueOnce('old-hash')
                .mockReturnValueOnce('new-hash');
            mockedGenerateJWT.mockResolvedValue({
                accessToken: 'new-access',
                refreshToken: 'new-refresh',
                expireDate,
            });
            sessionService.rotateSession.mockResolvedValue({} as never);

            const result = await service.refreshToken(refreshToken);

            expect(jwtService.verifyAsync).toHaveBeenCalledWith(refreshToken, {
                secret: 'refresh-secret',
            });
            expect(sessionService.rotateSession).toHaveBeenCalledWith(
                sessionId,
                'new-hash',
                expireDate,
            );
            expect(result).toEqual({
                accessToken: 'new-access',
                refreshToken: 'new-refresh',
            });
        });

        it('Case: làm mới token thất bại khi thiếu refresh token', async () => {
            await expect(service.refreshToken('')).rejects.toThrow(
                new UnauthorizedException('Không tìm thấy Refresh Token'),
            );
        });

        it('Case: làm mới token thất bại khi tokenVersion không khớp và phải revoke toàn bộ session', async () => {
            const payload = {
                _id: userId,
                role: 'USER',
                sessionId,
                tokenVersion: 0,
            };
            const user = createUser({ tokenVersion: 1 });

            jwtService.verifyAsync.mockResolvedValue(payload);
            usersService.findOne.mockResolvedValue(user as never);
            sessionService.revokeAllByUserId.mockResolvedValue({} as never);

            await expect(service.refreshToken(refreshToken)).rejects.toThrow(
                new UnauthorizedException('Token không hợp lệ'),
            );
            expect(sessionService.revokeAllByUserId).toHaveBeenCalledWith(
                userId,
            );
        });

        it('Case: làm mới token thất bại khi session đã hết hạn và phải revoke session đó', async () => {
            const payload = {
                _id: userId,
                role: 'USER',
                sessionId,
                tokenVersion: 0,
            };
            const user = createUser({ tokenVersion: 0 });
            const session: MockSession = {
                _id: new Types.ObjectId(sessionId),
                userId: new Types.ObjectId(userId),
                isRevoked: false,
                expiresAt: new Date(Date.now() - 60_000),
                refreshTokenHash: 'old-hash',
            };

            jwtService.verifyAsync.mockResolvedValue(payload);
            usersService.findOne.mockResolvedValue(user as never);
            sessionService.findSessionById.mockResolvedValue(session as never);
            sessionService.revoke.mockResolvedValue({} as never);

            await expect(service.refreshToken(refreshToken)).rejects.toThrow(
                new UnauthorizedException('Session đã hết hạn'),
            );
            expect(sessionService.revoke).toHaveBeenCalledWith(
                sessionId,
                userId,
            );
        });

        it('Case: làm mới token thất bại khi refresh token hash không khớp', async () => {
            const payload = {
                _id: userId,
                role: 'USER',
                sessionId,
                tokenVersion: 0,
            };
            const user = createUser({ tokenVersion: 0 });
            const session: MockSession = {
                _id: new Types.ObjectId(sessionId),
                userId: new Types.ObjectId(userId),
                isRevoked: false,
                expiresAt: new Date(Date.now() + 60_000),
                refreshTokenHash: 'stored-hash',
            };

            jwtService.verifyAsync.mockResolvedValue(payload);
            usersService.findOne.mockResolvedValue(user as never);
            sessionService.findSessionById.mockResolvedValue(session as never);
            mockedHashRefreshToken.mockReturnValue('different-hash');

            await expect(service.refreshToken(refreshToken)).rejects.toThrow(
                new UnauthorizedException(
                    'Refresh Token không hợp lệ hoặc đã được sử dụng',
                ),
            );
        });

        it('Case: refresh token hết hạn thì cố gắng dọn session cũ từ payload decode', async () => {
            const expiredError = Object.assign(new Error('expired'), {
                name: 'TokenExpiredError',
            });
            jwtService.verifyAsync.mockRejectedValue(expiredError);
            jwtService.decode.mockReturnValue({
                _id: userId,
                sessionId,
            });
            sessionService.revoke.mockResolvedValue({} as never);

            await expect(service.refreshToken(refreshToken)).rejects.toThrow(
                new UnauthorizedException(
                    'Refresh Token không hợp lệ hoặc đã hết hạn',
                ),
            );
            expect(sessionService.revoke).toHaveBeenCalledWith(
                sessionId,
                userId,
            );
        });
    });

    describe('logout', () => {
        it('Case: logout thành công thì revoke đúng session từ refresh token', async () => {
            jwtService.verifyAsync.mockResolvedValue({
                _id: userId,
                sessionId,
            });
            sessionService.revoke.mockResolvedValue({} as never);

            const result = await service.logout(refreshToken, userId);

            expect(sessionService.revoke).toHaveBeenCalledWith(
                sessionId,
                userId,
            );
            expect(result).toBeNull();
        });

        it('Case: logout trả về null ngay khi không có refresh token', async () => {
            const result = await service.logout('', userId);

            expect(result).toBeNull();
            expect(jwtService.verifyAsync).not.toHaveBeenCalled();
        });
    });

    describe('logoutAllDevices', () => {
        it('Case: đăng xuất tất cả thiết bị thành công khi tìm thấy user', async () => {
            const user = createUser({
                tokenVersion: 0,
                save: jest.fn().mockResolvedValue(undefined),
            });
            usersService.findOne.mockResolvedValue(user as never);
            sessionService.revokeAllByUserId.mockResolvedValue({} as never);

            const result = await service.logoutAllDevices(userId);

            expect(user.tokenVersion).toBe(1);
            expect(user.save).toHaveBeenCalled();
            expect(sessionService.revokeAllByUserId).toHaveBeenCalledWith(
                userId,
            );
            expect(result).toEqual({
                message: 'Đăng xuất tất cả các thiết bị thành công',
            });
        });

        it('Case: đăng xuất tất cả thiết bị thất bại thì ném lỗi nội bộ', async () => {
            usersService.findOne.mockResolvedValue(null);

            await expect(service.logoutAllDevices(userId)).rejects.toThrow(
                InternalServerErrorException,
            );
        });
    });

    describe('pass-through methods', () => {
        it('Case: activateUser gọi đúng qua usersService.activateUser', async () => {
            usersService.activateUser.mockResolvedValue({ ok: true } as never);

            const result = await service.activateUser('a@example.com', '123');

            expect(usersService.activateUser).toHaveBeenCalledWith(
                'a@example.com',
                '123',
            );
            expect(result).toEqual({ ok: true });
        });

        it('Case: reSendCodeActive gọi đúng qua usersService.reSendCodeActive', async () => {
            usersService.reSendCodeActive.mockResolvedValue('OK');

            const result = await service.reSendCodeActive('a@example.com');

            expect(usersService.reSendCodeActive).toHaveBeenCalledWith(
                'a@example.com',
            );
            expect(result).toBe('OK');
        });

        it('Case: changePassword gọi đúng qua usersService.updatePassword', async () => {
            const dto: ChangePasswordAuthDto = {
                passwordOld: 'old-pass',
                passwordNew: 'new-pass',
                confirmPassword: 'new-pass',
            };
            usersService.updatePassword.mockResolvedValue({
                ok: true,
            } as never);

            const result = await service.changePassword(userId, dto);

            expect(usersService.updatePassword).toHaveBeenCalledWith(
                userId,
                dto,
            );
            expect(result).toEqual({ ok: true });
        });

        it('Case: forgotPassword gọi đúng qua usersService.sendMailForgotPassword', async () => {
            usersService.sendMailForgotPassword.mockResolvedValue('OK');

            const result = await service.forgotPassword('a@example.com');

            expect(usersService.sendMailForgotPassword).toHaveBeenCalledWith(
                'a@example.com',
            );
            expect(result).toBe('OK');
        });

        it('Case: resetPassword gọi đúng qua usersService.resetPassword', async () => {
            const dto: ResetPasswordAuthDto = {
                email: 'a@example.com',
                code: '123',
                password: 'new-pass',
                confirmPassword: 'new-pass',
            };
            usersService.resetPassword.mockResolvedValue('OK' as never);

            const result = await service.resetPassword(dto);

            expect(usersService.resetPassword).toHaveBeenCalledWith(
                dto.email,
                dto.code,
                dto.password,
            );
            expect(result).toBe('OK');
        });
    });
});
