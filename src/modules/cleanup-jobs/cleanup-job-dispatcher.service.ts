/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
    BadRequestException,
    forwardRef,
    Inject,
    Injectable,
} from '@nestjs/common';
import { RedisService } from '@/redis/redis.service';
import { MediaService } from '../media/media.service';
import { CloudinaryDeliveryTypeEnum } from '../media/types/media';
import { SessionService } from '../session/session.service';
import { CLEANUP_JOB_MESSAGES } from './constants/cleanup-job.constant';
import { CleanupJobDocument } from './schemas/cleanup-job.schema';
import { CleanupJobActionEnum } from './types/cleanup-job';

@Injectable()
export class CleanupJobDispatcherService {
    constructor(
        @Inject(forwardRef(() => MediaService))
        private readonly mediaService: MediaService,

        @Inject(forwardRef(() => SessionService))
        private readonly sessionService: SessionService,

        @Inject(forwardRef(() => RedisService))
        private readonly redisService: RedisService,
    ) {}

    /** Xử lý job dọn rác (media claudinaty - R2, session, redis) */
    async dispatch(cleanupJob: CleanupJobDocument) {
        switch (cleanupJob.action) {
            case CleanupJobActionEnum.CLOUDINARY_DELETE_ONE:
                await this.handleCloudinaryDeleteOne(cleanupJob);
                break;
            case CleanupJobActionEnum.CLOUDINARY_DELETE_MANY:
                await this.handleCloudinaryDeleteMany(cleanupJob);
                break;
            case CleanupJobActionEnum.R2_DELETE_ONE:
                await this.handleR2DeleteOne(cleanupJob);
                break;
            case CleanupJobActionEnum.R2_DELETE_MANY:
                await this.handleR2DeleteMany(cleanupJob);
                break;
            case CleanupJobActionEnum.REDIS_REMOVE_UNSEEN_ONE:
                await this.handleRedisRemoveUnseenOne(cleanupJob);
                break;
            case CleanupJobActionEnum.REDIS_REMOVE_UNSEEN_MANY:
                await this.handleRedisRemoveUnseenMany(cleanupJob);
                break;
            case CleanupJobActionEnum.SESSION_REVOKE:
                await this.handleSessionRevoke(cleanupJob);
                break;
            case CleanupJobActionEnum.SESSION_REVOKE_ALL:
                await this.handleSessionRevokeAll(cleanupJob);
                break;
            default:
                throw new BadRequestException(
                    CLEANUP_JOB_MESSAGES.JOB_ACTION_NOT_SUPPORTED,
                );
        }
    }

    /** Xử lý job xóa 1 ảnh trên cloudinary */
    private async handleCloudinaryDeleteOne(cleanupJob: CleanupJobDocument) {
        const { publicId, deliveryType } = cleanupJob.payload;
        if (!publicId) {
            throw new BadRequestException(
                CLEANUP_JOB_MESSAGES.JOB_INVALID_PAYLOAD_PUBLIC_ID,
            );
        }
        return await this.mediaService.deleteFileFromCloudinary(
            publicId,
            deliveryType as CloudinaryDeliveryTypeEnum | undefined,
        );
    }

    /** Xử lý job xóa nhiều ảnh trên cloudinary */
    private async handleCloudinaryDeleteMany(cleanupJob: CleanupJobDocument) {
        const { publicIds, deliveryType } = cleanupJob.payload;
        if (!publicIds || !Array.isArray(publicIds) || publicIds.length === 0) {
            throw new BadRequestException(
                CLEANUP_JOB_MESSAGES.JOB_INVALID_PAYLOAD_PUBLIC_IDS,
            );
        }
        return await this.mediaService.deleteFilesFromCloudinary(
            publicIds,
            deliveryType as CloudinaryDeliveryTypeEnum | undefined,
        );
    }

    /** Xử lý job xóa 1 file trên r2 */
    private async handleR2DeleteOne(cleanupJob: CleanupJobDocument) {
        const { objectKey } = cleanupJob.payload;
        if (!objectKey) {
            throw new BadRequestException(
                CLEANUP_JOB_MESSAGES.JOB_INVALID_PAYLOAD_OBJECT_KEY,
            );
        }
        return await this.mediaService.deleteFileFromR2(objectKey);
    }

    /** Xử lý job xóa nhiều file trên r2 */
    private async handleR2DeleteMany(cleanupJob: CleanupJobDocument) {
        const { objectKeys } = cleanupJob.payload;
        if (
            !objectKeys ||
            !Array.isArray(objectKeys) ||
            objectKeys.length === 0
        ) {
            throw new BadRequestException(
                CLEANUP_JOB_MESSAGES.JOB_INVALID_PAYLOAD_OBJECT_KEYS,
            );
        }
        return await this.mediaService.deleteFilesFromR2(objectKeys);
    }

    /** Xử lý job xóa 1 key unseen trên redis */
    private async handleRedisRemoveUnseenOne(cleanupJob: CleanupJobDocument) {
        const { userId, conversationId } = cleanupJob.payload;
        if (!userId) {
            throw new BadRequestException(
                CLEANUP_JOB_MESSAGES.JOB_INVALID_PAYLOAD_USER_ID,
            );
        }
        if (!conversationId) {
            throw new BadRequestException(
                CLEANUP_JOB_MESSAGES.JOB_INVALID_PAYLOAD_CONVERSATION_ID,
            );
        }
        return await this.redisService.removeUnseenConversation(
            userId,
            conversationId,
        );
    }

    /** Xử lý job xóa nhiều key trên redis */
    private async handleRedisRemoveUnseenMany(cleanupJob: CleanupJobDocument) {
        const { userIds, conversationId } = cleanupJob.payload;
        if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
            throw new BadRequestException(
                CLEANUP_JOB_MESSAGES.JOB_INVALID_PAYLOAD_USER_IDS,
            );
        }
        if (!conversationId) {
            throw new BadRequestException(
                CLEANUP_JOB_MESSAGES.JOB_INVALID_PAYLOAD_CONVERSATION_ID,
            );
        }
        const result = await this.redisService.removeAllUnseenConversation(
            userIds,
            conversationId,
        );
        if (result.failedCount > 0 || !result.ok) {
            throw new BadRequestException(
                CLEANUP_JOB_MESSAGES.FAILED_TO_REMOVE_UNSEENS_FROM_REDIS,
            );
        }
        return result;
    }

    /** Xử lý job revoke 1 session của user*/
    private async handleSessionRevoke(cleanupJob: CleanupJobDocument) {
        const { userId, sessionId } = cleanupJob.payload;
        if (!userId) {
            throw new BadRequestException(
                CLEANUP_JOB_MESSAGES.JOB_INVALID_PAYLOAD_USER_ID,
            );
        }
        if (!sessionId) {
            throw new BadRequestException(
                CLEANUP_JOB_MESSAGES.JOB_INVALID_PAYLOAD_SESSION_ID,
            );
        }

        const session = await this.sessionService.findSessionById(sessionId);
        if (
            !session ||
            session.userId?.toString() !== userId ||
            session.isRevoked ||
            (session.expiresAt && session.expiresAt.getTime() <= Date.now())
        ) {
            return session;
        }

        return await this.sessionService.revoke(sessionId, userId);
    }

    /** Xử lý job revoke tất cả session của user*/
    private async handleSessionRevokeAll(cleanupJob: CleanupJobDocument) {
        const { userId } = cleanupJob.payload;
        if (!userId) {
            throw new BadRequestException(
                CLEANUP_JOB_MESSAGES.JOB_INVALID_PAYLOAD_USER_ID,
            );
        }

        const sessions = await this.sessionService.findSessionsByUserId(userId);
        const hasActiveSession = sessions.some(
            (session) =>
                session.expiresAt && session.expiresAt.getTime() > Date.now(),
        );
        if (!hasActiveSession) {
            return sessions;
        }

        return await this.sessionService.revokeAllByUserId(userId);
    }
}
