/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Session } from './schemas/session.schema';
import { Model } from 'mongoose';
import { toObjectId } from '@/utils/utils';
import { randomUUID } from 'crypto';
import { SessionDeviceResponse } from './types/session';
import { CleanupJobsService } from '../cleanup-jobs/cleanup-jobs.service';

@Injectable()
export class SessionDeviceService {
    constructor(
        @InjectModel(Session.name) public sessionModel: Model<Session>,
        @Inject(forwardRef(() => CleanupJobsService))
        private readonly cleanupJobsService: CleanupJobsService,
    ) {}

    /**
     * Lấy danh sách thiết bị đang hoạt động của một user, gom theo `deviceId`
     * để mỗi browser/device chỉ xuất hiện một lần trong UI.
     */
    async findDevicesByUserId(
        userId: string,
    ): Promise<SessionDeviceResponse[]> {
        const objectId = toObjectId(userId, 'user id');

        const sessions = await this.sessionModel
            .find({ userId: objectId, isRevoked: false })
            .sort({ lastUsedAt: -1, updatedAt: -1, createdAt: -1 })
            .select(
                '_id deviceId deviceName userAgent expiresAt lastUsedAt createdAt updatedAt',
            )
            .lean();

        const groupedDevices = new Map<string, SessionDeviceResponse>();

        for (const session of sessions as Array<any>) {
            const deviceId = session.deviceId.trim();

            if (groupedDevices.has(deviceId)) continue;

            groupedDevices.set(deviceId, {
                _id: session._id.toString(),
                deviceId,
                deviceName: session.deviceName,
                userAgent: session.userAgent,
                expiresAt: session.expiresAt,
                lastUsedAt: session.lastUsedAt,
                createdAt: session.createdAt,
                updatedAt: session.updatedAt,
            });
        }

        return Array.from(groupedDevices.values());
    }

    /**
     * Xác định device hiện tại có phải device mới hay không.
     * Nếu request chưa có `deviceId`, sinh một UUID mới và coi là device mới.
     */
    async resolveDeviceContext(userId: string, deviceId?: string) {
        if (!deviceId) {
            return { deviceId: randomUUID(), isNewDevice: true };
        }

        const isKnownDevice = await this.hasSessionByUserIdAndDeviceId(
            userId,
            deviceId,
        );

        return {
            deviceId,
            isNewDevice: !isKnownDevice,
        };
    }

    /**
     * Kiểm tra user hiện có session cùng `deviceId` hay không.
     */
    async hasSessionByUserIdAndDeviceId(userId: string, deviceId: string) {
        const objectId = toObjectId(userId, 'user id');

        const count = await this.sessionModel.countDocuments({
            userId: objectId,
            deviceId,
        });

        return count > 0;
    }

    /**
     * Xóa toàn bộ session của user theo `deviceId`.
     */
    async removeDevice(userId: string, deviceId: string) {
        const objectId = toObjectId(userId, 'user id');

        const result = await this.sessionModel.deleteMany({
            userId: objectId,
            deviceId,
        });

        return {
            deletedCount: result.deletedCount,
        };
    }
}
