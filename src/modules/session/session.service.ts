import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Session } from './schemas/session.schema';
import { Model } from 'mongoose';
import { CreateSessionDto } from './dto/create-session.dto';

@Injectable()
export class SessionService {
    constructor(
        @InjectModel(Session.name) public sessionModel: Model<Session>,
    ) {}
    async create(createSessionDto: CreateSessionDto) {
        return await this.sessionModel.create(createSessionDto);
    }

    async findSessionById(id: string) {
        return await this.sessionModel.findById(id);
    }

    async rotateSession(
        _id: string,
        refreshTokenHash: string,
        expiresAt: Date,
    ) {
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

    async revoke(_id: string, userId: string) {
        return this.sessionModel.updateOne(
            { _id, userId, isRevoked: false },
            {
                $set: {
                    isRevoked: true,
                    revokedAt: new Date(),
                },
            },
        );
    }

    async revokeAllByUserId(userId: string) {
        return this.sessionModel.updateMany(
            { userId, isRevoked: false },
            {
                $set: {
                    isRevoked: true,
                    revokedAt: new Date(),
                },
            },
        );
    }
}
