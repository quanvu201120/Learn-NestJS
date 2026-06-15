/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Session } from './schemas/session.schema';
import { Model, Types } from 'mongoose';
import { CreateSessionDto } from './dto/create-session.dto';
import { validateObjectId } from '@/utils/utils';

@Injectable()
export class SessionService {
    constructor(
        @InjectModel(Session.name) public sessionModel: Model<Session>,
    ) {}

    /**
     * Tạo session đăng nhập bền vững cho một thiết bị hoặc trình duyệt.
     */
    async create(createSessionDto: CreateSessionDto) {
        return await this.sessionModel.create(createSessionDto);
    }

    /**
     * Tìm một session theo id sau khi kiểm tra định dạng ObjectId hợp lệ.
     */
    async findSessionById(id: string) {
        validateObjectId(id, 'session id');
        return await this.sessionModel.findById(id);
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
}
