import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SessionService } from './session.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { validateObjectId } from '@/utils/utils';

jest.mock('@/utils/utils', () => ({
    __esModule: true,
    validateObjectId: jest.fn(),
}));

type MockSessionModel = {
    create: jest.Mock;
    findById: jest.Mock;
    updateOne: jest.Mock;
    updateMany: jest.Mock;
};

describe('SessionService', () => {
    let service: SessionService;
    let sessionModel: MockSessionModel;

    const sessionId = new Types.ObjectId().toString();
    const userId = new Types.ObjectId().toString();
    const expiresAt = new Date('2026-01-01T00:00:00.000Z');

    const mockedValidateObjectId = validateObjectId as jest.MockedFunction<
        typeof validateObjectId
    >;

    beforeEach(() => {
        sessionModel = {
            create: jest.fn(),
            findById: jest.fn(),
            updateOne: jest.fn(),
            updateMany: jest.fn(),
        };

        service = new SessionService(sessionModel as never);

        mockedValidateObjectId.mockReset();
        mockedValidateObjectId.mockImplementation(
            (id: string, fieldName: string) => {
                if (!Types.ObjectId.isValid(id)) {
                    throw new BadRequestException(`Invalid ${fieldName}`);
                }
            },
        );
    });

    describe('create', () => {
        it('Case: tạo session thành công với dữ liệu hợp lệ', async () => {
            const dto: CreateSessionDto = {
                userId,
                userAgent: 'Chrome',
                deviceName: 'Laptop',
            };
            const createdSession = {
                _id: new Types.ObjectId(sessionId),
                ...dto,
            };
            sessionModel.create.mockResolvedValue(createdSession);

            const result = await service.create(dto);

            expect(sessionModel.create).toHaveBeenCalledWith(dto);
            expect(result).toBe(createdSession);
        });
    });

    describe('findSessionById', () => {
        it('Case: lấy session theo id thành công', async () => {
            const foundSession = {
                _id: new Types.ObjectId(sessionId),
                userId: new Types.ObjectId(userId),
            };
            sessionModel.findById.mockResolvedValue(foundSession);

            const result = await service.findSessionById(sessionId);

            expect(mockedValidateObjectId).toHaveBeenCalledWith(
                sessionId,
                'session id',
            );
            expect(sessionModel.findById).toHaveBeenCalledWith(sessionId);
            expect(result).toBe(foundSession);
        });

        it('Case: lấy session theo id thất bại khi session id không hợp lệ', async () => {
            await expect(service.findSessionById('invalid-id')).rejects.toThrow(
                new BadRequestException('Invalid session id'),
            );
        });
    });

    describe('rotateSession', () => {
        it('Case: rotate session thành công khi session id hợp lệ', async () => {
            const updateResult = { acknowledged: true, modifiedCount: 1 };
            sessionModel.updateOne.mockResolvedValue(updateResult);

            const result = await service.rotateSession(
                sessionId,
                'new-refresh-hash',
                expiresAt,
            );

            expect(mockedValidateObjectId).toHaveBeenCalledWith(
                sessionId,
                'session id',
            );
            expect(sessionModel.updateOne).toHaveBeenCalledWith(
                { _id: sessionId, isRevoked: false },
                {
                    $set: {
                        refreshTokenHash: 'new-refresh-hash',
                        expiresAt,
                        lastUsedAt: expect.any(Date),
                    },
                },
            );
            expect(result).toBe(updateResult);
        });

        it('Case: rotate session thất bại khi session id không hợp lệ', async () => {
            await expect(
                service.rotateSession('invalid-id', 'hash', expiresAt),
            ).rejects.toThrow(new BadRequestException('Invalid session id'));
        });
    });

    describe('revoke', () => {
        it('Case: revoke session thành công khi session id và user id hợp lệ', async () => {
            const updateResult = { acknowledged: true, modifiedCount: 1 };
            sessionModel.updateOne.mockResolvedValue(updateResult);

            const result = await service.revoke(sessionId, userId);

            expect(mockedValidateObjectId).toHaveBeenNthCalledWith(
                1,
                sessionId,
                'session id',
            );
            expect(mockedValidateObjectId).toHaveBeenNthCalledWith(
                2,
                userId,
                'user id',
            );
            expect(sessionModel.updateOne).toHaveBeenCalledWith(
                {
                    _id: sessionId,
                    userId: expect.any(Types.ObjectId),
                    isRevoked: false,
                },
                {
                    $set: {
                        isRevoked: true,
                        revokedAt: expect.any(Date),
                    },
                },
            );
            expect(result).toBe(updateResult);
        });

        it('Case: revoke session thất bại khi session id không hợp lệ', async () => {
            await expect(service.revoke('invalid-id', userId)).rejects.toThrow(
                new BadRequestException('Invalid session id'),
            );
        });

        it('Case: revoke session thất bại khi user id không hợp lệ', async () => {
            await expect(service.revoke(sessionId, 'invalid-id')).rejects.toThrow(
                new BadRequestException('Invalid user id'),
            );
        });
    });

    describe('revokeAllByUserId', () => {
        it('Case: revoke toàn bộ session của một user thành công', async () => {
            const updateResult = { acknowledged: true, modifiedCount: 2 };
            sessionModel.updateMany.mockResolvedValue(updateResult);

            const result = await service.revokeAllByUserId(userId);

            expect(mockedValidateObjectId).toHaveBeenCalledWith(
                userId,
                'user id',
            );
            expect(sessionModel.updateMany).toHaveBeenCalledWith(
                {
                    userId: expect.any(Types.ObjectId),
                    isRevoked: false,
                },
                {
                    $set: {
                        isRevoked: true,
                        revokedAt: expect.any(Date),
                    },
                },
            );
            expect(result).toBe(updateResult);
        });

        it('Case: revoke toàn bộ session thất bại khi user id không hợp lệ', async () => {
            await expect(
                service.revokeAllByUserId('invalid-id'),
            ).rejects.toThrow(new BadRequestException('Invalid user id'));
        });
    });
});
