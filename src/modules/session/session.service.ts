/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Session } from './schemas/session.schema';
import { Model, Types } from 'mongoose';
import { CreateSessionDto } from './dto/create-session.dto';
import { toObjectId, validateObjectId } from '@/utils/utils';
import { CleanupJobsService } from '../cleanup-jobs/cleanup-jobs.service';
import { CreateCleanupJobDto } from '../cleanup-jobs/dto/create-cleanup-job.dto';
import {
    CleanupJobActionEnum,
    CleanupJobEntityEnum,
    CleanupJobResourceEnum,
} from '../cleanup-jobs/types/cleanup-job';
import { SessionDeviceResponse } from './types/session';
import { SessionDeviceService } from './session-device.service';

@Injectable()
export class SessionService {
    constructor(
        @InjectModel(Session.name) public sessionModel: Model<Session>,
        @Inject(forwardRef(() => CleanupJobsService))
        private readonly cleanupJobsService: CleanupJobsService,
        private readonly sessionDeviceService: SessionDeviceService,
    ) {}

    /**
     * Tạo session đăng nhập bền vững cho một thiết bị hoặc trình duyệt.
     */
    async create(createSessionDto: CreateSessionDto) {
        const userId = toObjectId(createSessionDto.userId, 'user id');
        return await this.sessionModel.create({
            ...createSessionDto,
            userId,
        });
    }

    /**
     * Tìm một session theo id sau khi kiểm tra định dạng ObjectId hợp lệ.
     */
    async findSessionById(id: string) {
        validateObjectId(id, 'session id');
        return await this.sessionModel.findById(id);
    }

    /**
     * Lấy các session chưa bị revoke của user.
     */
    async findSessionsByUserId(userId: string) {
        const objectId = toObjectId(userId, 'user id');

        const sessions = await this.sessionModel
            .find({ userId: objectId, isRevoked: false })
            .sort({ lastUsedAt: -1, createdAt: -1 })
            .select(
                '_id deviceId deviceName userAgent expiresAt lastUsedAt createdAt updatedAt',
            );

        return sessions.map((session) => {
            const currentSession = session as any;

            return {
                _id: currentSession._id.toString(),
                deviceId: currentSession.deviceId,
                deviceName: currentSession.deviceName,
                userAgent: currentSession.userAgent,
                expiresAt: currentSession.expiresAt,
                lastUsedAt: currentSession.lastUsedAt,
                createdAt: currentSession.createdAt,
                updatedAt: currentSession.updatedAt,
            };
        });
    }

    /**
     * Facade cho việc lấy danh sách thiết bị đã được gom theo `deviceId`.
     */
    async getDevices(userId: string): Promise<SessionDeviceResponse[]> {
        return await this.sessionDeviceService.findDevicesByUserId(userId);
    }

    /**
     * Facade cho thao tác xóa một thiết bị, xóa toàn bộ session cùng `deviceId`.
     */
    async removeDevice(userId: string, deviceId: string) {
        return await this.sessionDeviceService.removeDevice(userId, deviceId);
    }

    /**
     * Facade cho việc xác định device hiện tại có phải device mới hay không.
     */
    async resolveDeviceContext(userId: string, deviceId?: string) {
        return await this.sessionDeviceService.resolveDeviceContext(
            userId,
            deviceId,
        );
    }

    /**
     * Cập nhật refresh token hash và thời gian hết hạn mới cho session đang hoạt động.
     */
    async rotateSession(
        _id: string,
        refreshTokenHash: string,
        expiresAt: Date,
    ) {
        validateObjectId(_id, 'session id');

        return await this.sessionModel.updateOne(
            { _id, isRevoked: false },
            {
                $set: {
                    refreshTokenHash,
                    expiresAt,
                    lastUsedAt: new Date(),
                },
            },
        );
    }

    /**
     * Thu hồi một session đang hoạt động của user.
     */
    async revoke(_id: string, userId: string) {
        validateObjectId(_id, 'session id');
        validateObjectId(userId, 'user id');

        return await this.sessionModel.updateOne(
            { _id, userId: new Types.ObjectId(userId), isRevoked: false },
            {
                $set: {
                    isRevoked: true,
                    revokedAt: new Date(),
                },
            },
        );
    }

    async revokeWithCleanup(
        _id: string,
        userId: string,
        messageError?: string,
    ) {
        try {
            return await this.revoke(_id, userId);
        } catch (error) {
            await this.addSessionRevokeCleanupJob(
                userId,
                _id,
                messageError ?? (error as Error)?.message,
            );
            return null;
        }
    }

    /**
     * Thu hồi toàn bộ session đang hoạt động của một user.
     */
    async revokeAllByUserId(userId: string) {
        validateObjectId(userId, 'user id');

        return await this.sessionModel.updateMany(
            { userId: new Types.ObjectId(userId), isRevoked: false },
            {
                $set: {
                    isRevoked: true,
                    revokedAt: new Date(),
                },
            },
        );
    }

    async revokeAllByUserIdWithCleanup(userId: string, messageError?: string) {
        try {
            return await this.revokeAllByUserId(userId);
        } catch (error) {
            await this.addSessionRevokeAllCleanupJob(
                userId,
                messageError ?? (error as Error)?.message,
            );
            return null;
        }
    }

    private async addSessionRevokeCleanupJob(
        userId: string,
        sessionId: string,
        messageError?: string,
    ) {
        try {
            const createDto: CreateCleanupJobDto = {
                resourceType: CleanupJobResourceEnum.SESSION,
                action: CleanupJobActionEnum.SESSION_REVOKE,
                entityId: userId,
                entityType: CleanupJobEntityEnum.USER,
                payload: {
                    userId,
                    sessionId,
                },
                error: messageError,
            };
            await this.cleanupJobsService.createCleanupJob(createDto);
        } catch (error) {
            console.error('Failed to create cleanup job: ', error);
        }
    }

    private async addSessionRevokeAllCleanupJob(
        userId: string,
        messageError?: string,
    ) {
        try {
            const createDto: CreateCleanupJobDto = {
                resourceType: CleanupJobResourceEnum.SESSION,
                action: CleanupJobActionEnum.SESSION_REVOKE_ALL,
                entityId: userId,
                entityType: CleanupJobEntityEnum.USER,
                payload: {
                    userId,
                },
                error: messageError,
            };
            await this.cleanupJobsService.createCleanupJob(createDto);
        } catch (error) {
            console.error('Failed to create cleanup job: ', error);
        }
    }
}
