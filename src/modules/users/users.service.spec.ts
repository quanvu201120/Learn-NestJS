import { BadRequestException } from '@nestjs/common';
import aqp from 'api-query-params';
import bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordAuthDto } from '@/auth/dto/password-auth.dto';
import {
    hashCodeVerifyEmail,
    hashPassword,
    validateObjectId,
} from '@/utils/utils';

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

jest.mock('@/utils/utils', () => {
    const { BadRequestException } = require('@nestjs/common');

    return {
        __esModule: true,
        hashPassword: jest.fn(async (password: string) => `hashed-${password}`),
        formatExpireTime: jest.fn(() => '1 phút'),
        hashCodeVerifyEmail: jest.fn(
            (code: string, pepper: string) => `hashed-${code}-${pepper}`,
        ),
        validateObjectId: jest.fn((id: string, fieldName: string) => {
            if (!Types.ObjectId.isValid(id)) {
                throw new BadRequestException(`Invalid ${fieldName}`);
            }
        }),
    };
});

type MockUserDocument = {
    _id: Types.ObjectId;
    name?: string;
    email: string;
    password: string;
    role?: string;
    isActive?: boolean;
    toObject: jest.Mock;
    save: jest.Mock;
};

type MockUserModel = {
    exists: jest.Mock;
    create: jest.Mock;
    find: jest.Mock;
    findById: jest.Mock;
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
    deleteOne: jest.Mock;
    countDocuments: jest.Mock;
};

describe('UsersService', () => {
    let service: UsersService;
    let userModel: MockUserModel;
    let configService: { get: jest.Mock };
    let redisService: {
        get: jest.Mock;
        del: jest.Mock;
        ttl: jest.Mock;
        setWithTTL: jest.Mock;
    };

    const userId = new Types.ObjectId().toString();
    const createUserDto: CreateUserDto = {
        name: 'Quan Vu',
        email: 'quan@example.com',
        password: '123456',
        confirmPassword: '123456',
        role: 'USER',
    };

    const createUserDocument = (
        overrides: Partial<MockUserDocument> = {},
    ): MockUserDocument => {
        const base = {
            _id: new Types.ObjectId(),
            name: 'Quan Vu',
            email: 'quan@example.com',
            password: 'hashed-123456',
            role: 'USER',
            isActive: false,
        };

        const user = {
            ...base,
            ...overrides,
        };

        return {
            ...user,
            toObject: jest.fn(() => ({
                ...user,
                __v: 0,
            })),
            save: jest.fn().mockResolvedValue(user),
        };
    };

    const createFindChain = <T>(value: T[]) => {
        const chain = {
            skip: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            sort: jest.fn().mockResolvedValue(value),
        };

        return chain;
    };

    const createFindOneSelectChain = <T>(value: T) => ({
        select: jest.fn().mockResolvedValue(value),
    });

    const createFindOneSelectLeanChain = <T>(value: T) => ({
        select: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue(value),
        }),
    });

    const mockedAqp = aqp as jest.MockedFunction<typeof aqp>;
    const mockedHashPassword = hashPassword as jest.MockedFunction<
        typeof hashPassword
    >;
    const mockedHashCodeVerifyEmail = hashCodeVerifyEmail as jest.MockedFunction<
        typeof hashCodeVerifyEmail
    >;
    const mockedValidateObjectId = validateObjectId as jest.MockedFunction<
        typeof validateObjectId
    >;
    const mockedBcryptCompare = bcrypt.compare as jest.MockedFunction<
        typeof bcrypt.compare
    >;

    beforeEach(() => {
        userModel = {
            exists: jest.fn(),
            create: jest.fn(),
            find: jest.fn(),
            findById: jest.fn(),
            findOne: jest.fn(),
            findOneAndUpdate: jest.fn(),
            deleteOne: jest.fn(),
            countDocuments: jest.fn(),
        };

        configService = {
            get: jest.fn((key: string) => {
                const map: Record<string, string> = {
                    MAIL_CODE_ACTIVE_EXPIRE: '1m',
                    MAIL_CODE_FORGOT_EXPIRE: '1m',
                    MAIL_REGISTER_TEMPLATE: 'register',
                    MAIL_FORGOT_TEMPLATE: 'forgot-password',
                    CODE_VERIFY_PEPPER: 'pepper',
                };
                return map[key];
            }),
        };

        redisService = {
            get: jest.fn(),
            del: jest.fn(),
            ttl: jest.fn(),
            setWithTTL: jest.fn(),
        };

        service = new UsersService(
            userModel as never,
            configService as never,
            redisService as never,
        );

        mockedAqp.mockReturnValue({ filter: {}, sort: {} } as never);
        mockedHashPassword.mockImplementation(
            async (password: string) => `hashed-${password}`,
        );
        mockedHashCodeVerifyEmail.mockImplementation(
            (code: string, pepper: string) => `hashed-${code}-${pepper}`,
        );
        mockedValidateObjectId.mockImplementation(
            (id: string, fieldName: string) => {
                if (!Types.ObjectId.isValid(id)) {
                    throw new BadRequestException(`Invalid ${fieldName}`);
                }
            },
        );
        mockedBcryptCompare.mockReset();
    });

    describe('create', () => {
        it('Case: tạo user thành công khi email chưa tồn tại', async () => {
            const userDocument = createUserDocument();
            userModel.exists.mockResolvedValue(null);
            userModel.create.mockResolvedValue(userDocument);
            redisService.setWithTTL.mockResolvedValue(undefined);
            jest.spyOn(service, 'sendEmailActive').mockResolvedValue({} as never);

            const result = await service.create(createUserDto);

            expect(userModel.exists).toHaveBeenCalledWith({
                email: createUserDto.email,
            });
            expect(mockedHashPassword).toHaveBeenCalledWith(
                createUserDto.password,
            );
            expect(userModel.create).toHaveBeenCalledWith({
                ...createUserDto,
                password: 'hashed-123456',
                isActive: false,
            });
            expect(redisService.setWithTTL).toHaveBeenCalledTimes(1);
            expect(service.sendEmailActive).toHaveBeenCalledWith(
                createUserDto.email,
                'mock-uuid',
            );
            expect(result).toMatchObject({
                _id: userDocument._id,
                email: userDocument.email,
                isActive: false,
            });
            expect(result).not.toHaveProperty('password');
        });

        it('Case: tạo user thất bại khi email đã tồn tại', async () => {
            userModel.exists.mockResolvedValue(true);

            await expect(service.create(createUserDto)).rejects.toThrow(
                new BadRequestException('Email already existed'),
            );
        });
    });

    describe('findAll', () => {
        it('Case: lấy danh sách user có phân trang thành công', async () => {
            const users = [createUserDocument(), createUserDocument()];
            const chain = createFindChain(users);
            userModel.find.mockReturnValueOnce(users).mockReturnValueOnce(chain);
            mockedAqp.mockReturnValue({
                filter: { role: 'USER', current: 1, pageSize: 10 },
                sort: { createdAt: -1 },
            } as never);

            const result = await service.findAll('role=USER', 1, 10);

            expect(userModel.find).toHaveBeenNthCalledWith(1, { role: 'USER' });
            expect(chain.skip).toHaveBeenCalledWith(0);
            expect(chain.limit).toHaveBeenCalledWith(10);
            expect(chain.select).toHaveBeenCalledWith('-password');
            expect(result.totalPages).toBe(1);
            expect(result.users).toBe(users);
        });
    });

    describe('findOne', () => {
        it('Case: lấy chi tiết user theo id thành công', async () => {
            const userDocument = createUserDocument({ _id: new Types.ObjectId(userId) });
            userModel.findById.mockResolvedValue(userDocument);

            const result = await service.findOne(userId);

            expect(userModel.findById).toHaveBeenCalledWith(userId);
            expect(result).toBe(userDocument);
        });

        it('Case: lấy chi tiết user thất bại khi id không hợp lệ', async () => {
            await expect(service.findOne('invalid-id')).rejects.toThrow(
                new BadRequestException('Invalid user id'),
            );
        });
    });

    describe('update', () => {
        it('Case: cập nhật user thành công khi email mới không bị trùng', async () => {
            const updateDto: UpdateUserDto = {
                _id: userId,
                name: 'Quan moi',
                email: 'new@example.com',
            };
            const updatedUser = createUserDocument({
                _id: new Types.ObjectId(userId),
                name: 'Quan moi',
                email: 'new@example.com',
            });
            userModel.exists.mockResolvedValue(null);
            userModel.findOneAndUpdate.mockReturnValue({
                select: jest.fn().mockResolvedValue(updatedUser),
            });

            const result = await service.update(updateDto, userId, 'ADMIN');

            expect(userModel.exists).toHaveBeenCalledWith({
                email: updateDto.email,
                _id: { $ne: updateDto._id },
            });
            expect(result).toBe(updatedUser);
        });

        it('Case: cập nhật user thất bại khi email mới đã tồn tại', async () => {
            const updateDto: UpdateUserDto = {
                _id: userId,
                name: 'Quan Vu',
                email: 'dup@example.com',
            };
            userModel.exists.mockResolvedValue(true);

            await expect(service.update(updateDto, userId, 'ADMIN')).rejects.toThrow(
                new BadRequestException('Email already existed'),
            );
        });
    });

    describe('deleteUser', () => {
        it('Case: xóa user thành công theo id hợp lệ', async () => {
            userModel.deleteOne.mockResolvedValue({ deletedCount: 1 });

            const result = await service.deleteUser(userId);

            expect(userModel.deleteOne).toHaveBeenCalledWith({ _id: userId });
            expect(result).toEqual({ deletedCount: 1 });
        });

        it('Case: xóa user thất bại khi id không hợp lệ', async () => {
            await expect(service.deleteUser('invalid-id')).rejects.toThrow(
                new BadRequestException('Invalid user id'),
            );
        });
    });

    describe('activateUser', () => {
        it('Case: kích hoạt tài khoản thành công khi code đúng', async () => {
            const userDocument = createUserDocument({
                _id: new Types.ObjectId(userId),
                email: createUserDto.email,
                isActive: false,
            });
            userModel.findOne.mockReturnValue(
                createFindOneSelectChain(userDocument),
            );
            redisService.get.mockResolvedValue('hashed-123-pepper');
            redisService.del.mockResolvedValue(1);
            userDocument.save.mockResolvedValue({
                ...userDocument,
                isActive: true,
            });

            const result = await service.activateUser(createUserDto.email, '123');

            expect(redisService.get).toHaveBeenCalledWith(`auth:active:${userId}`);
            expect(redisService.del).toHaveBeenCalledWith(`auth:active:${userId}`);
            expect(userDocument.save).toHaveBeenCalled();
            expect(result).toMatchObject({
                isActive: true,
            });
        });

        it('Case: kích hoạt tài khoản thất bại khi không tìm thấy user', async () => {
            userModel.findOne.mockReturnValue(createFindOneSelectChain(null));

            await expect(
                service.activateUser(createUserDto.email, '123'),
            ).rejects.toThrow(new BadRequestException('User not found'));
        });

        it('Case: kích hoạt tài khoản thất bại khi user đã active', async () => {
            const userDocument = createUserDocument({
                isActive: true,
            });
            userModel.findOne.mockReturnValue(
                createFindOneSelectChain(userDocument),
            );

            await expect(
                service.activateUser(createUserDto.email, '123'),
            ).rejects.toThrow(
                new BadRequestException('User is already active'),
            );
        });
    });

    describe('reSendCodeActive', () => {
        it('Case: gửi lại mã kích hoạt thành công khi user chưa active', async () => {
            const user = {
                _id: new Types.ObjectId(userId),
                email: createUserDto.email,
                isActive: false,
            };
            userModel.findOne.mockReturnValue(
                createFindOneSelectLeanChain(user),
            );
            redisService.ttl.mockResolvedValue(-1);
            redisService.setWithTTL.mockResolvedValue(undefined);
            jest.spyOn(service, 'sendEmailActive').mockResolvedValue({} as never);

            const result = await service.reSendCodeActive(createUserDto.email);

            expect(result).toBe('OK');
            expect(redisService.setWithTTL).toHaveBeenCalledTimes(1);
            expect(service.sendEmailActive).toHaveBeenCalledWith(
                createUserDto.email,
                'mock-uuid',
            );
        });

        it('Case: gửi lại mã kích hoạt thất bại khi user đã active', async () => {
            const user = {
                _id: new Types.ObjectId(userId),
                email: createUserDto.email,
                isActive: true,
            };
            userModel.findOne.mockReturnValue(
                createFindOneSelectLeanChain(user),
            );

            await expect(
                service.reSendCodeActive(createUserDto.email),
            ).rejects.toThrow(
                new BadRequestException('User is already active'),
            );
        });
    });

    describe('updatePassword', () => {
        it('Case: đổi mật khẩu thành công khi password cũ đúng', async () => {
            const userDocument = createUserDocument({
                _id: new Types.ObjectId(userId),
                password: 'old-hash',
            });
            const dto: ChangePasswordAuthDto = {
                passwordOld: 'old-pass',
                passwordNew: 'new-pass',
                confirmPassword: 'new-pass',
            };
            userModel.findById.mockResolvedValue(userDocument);
            mockedBcryptCompare.mockResolvedValue(true as never);
            userDocument.save.mockResolvedValue(userDocument);

            const result = await service.updatePassword(userId, dto);

            expect(mockedBcryptCompare).toHaveBeenCalledWith(
                dto.passwordOld,
                'old-hash',
            );
            expect(mockedHashPassword).toHaveBeenCalledWith(dto.passwordNew);
            expect(userDocument.save).toHaveBeenCalled();
            expect(result).toEqual({
                _id: userDocument._id,
                email: userDocument.email,
                message: 'Change password successfully',
            });
        });

        it('Case: đổi mật khẩu thất bại khi không tìm thấy user', async () => {
            const dto: ChangePasswordAuthDto = {
                passwordOld: 'old-pass',
                passwordNew: 'new-pass',
                confirmPassword: 'new-pass',
            };
            userModel.findById.mockResolvedValue(null);

            await expect(service.updatePassword(userId, dto)).rejects.toThrow(
                new BadRequestException('User not found'),
            );
        });

        it('Case: đổi mật khẩu thất bại khi password cũ không đúng', async () => {
            const userDocument = createUserDocument({
                _id: new Types.ObjectId(userId),
                password: 'old-hash',
            });
            const dto: ChangePasswordAuthDto = {
                passwordOld: 'wrong-pass',
                passwordNew: 'new-pass',
                confirmPassword: 'new-pass',
            };
            userModel.findById.mockResolvedValue(userDocument);
            mockedBcryptCompare.mockResolvedValue(false as never);

            await expect(service.updatePassword(userId, dto)).rejects.toThrow(
                new BadRequestException('Invalid password'),
            );
        });
    });

    describe('sendMailForgotPassword', () => {
        it('Case: gửi mail quên mật khẩu thành công khi email tồn tại', async () => {
            const user = {
                _id: new Types.ObjectId(userId),
            };
            userModel.findOne.mockReturnValue(
                createFindOneSelectLeanChain(user),
            );
            redisService.ttl.mockResolvedValue(-1);
            redisService.setWithTTL.mockResolvedValue(undefined);
            jest.spyOn(service as never, 'sendEmailViaResend' as never).mockResolvedValue(
                {} as never,
            );

            const result = await service.sendMailForgotPassword(
                createUserDto.email,
            );

            expect(result).toBe('OK');
            expect(redisService.setWithTTL).toHaveBeenCalledTimes(1);
        });

        it('Case: gửi mail quên mật khẩu thất bại khi email không tồn tại', async () => {
            userModel.findOne.mockReturnValue(createFindOneSelectLeanChain(null));

            await expect(
                service.sendMailForgotPassword(createUserDto.email),
            ).rejects.toThrow(new BadRequestException('Email not found'));
        });
    });

    describe('resetPassword', () => {
        it('Case: đặt lại mật khẩu thành công khi code đúng', async () => {
            const userDocument = createUserDocument({
                _id: new Types.ObjectId(userId),
                password: 'old-hash',
            });
            userModel.findOne.mockReturnValue(
                createFindOneSelectChain(userDocument),
            );
            redisService.get.mockResolvedValue('hashed-456-pepper');
            redisService.del.mockResolvedValue(1);
            userDocument.save.mockResolvedValue(userDocument);

            const result = await service.resetPassword(
                createUserDto.email,
                '456',
                'new-pass',
            );

            expect(mockedHashPassword).toHaveBeenCalledWith('new-pass');
            expect(userDocument.save).toHaveBeenCalled();
            expect(result).toBe('Reset password successfully');
        });

        it('Case: đặt lại mật khẩu thất bại khi email không tồn tại', async () => {
            userModel.findOne.mockReturnValue(createFindOneSelectChain(null));

            await expect(
                service.resetPassword(createUserDto.email, '456', 'new-pass'),
            ).rejects.toThrow(new BadRequestException('Email not found'));
        });
    });

    describe('countUserIdsExist', () => {
        it('Case: đếm số lượng user id tồn tại thành công', async () => {
            const objectUserIds = [
                new Types.ObjectId(),
                new Types.ObjectId(),
            ];
            userModel.countDocuments.mockResolvedValue(2);

            const result = await service.countUserIdsExist(objectUserIds);

            expect(userModel.countDocuments).toHaveBeenCalledWith({
                _id: { $in: objectUserIds },
            });
            expect(result).toBe(2);
        });
    });
});
