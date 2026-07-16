/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
    BadRequestException,
    forwardRef,
    Inject,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { CleanupJob, CleanupJobDocument } from './schemas/cleanup-job.schema';
import { Model } from 'mongoose';
import { SessionService } from '../session/session.service';
import { MediaService } from '../media/media.service';
import { RedisService } from '@/redis/redis.service';
import { CreateCleanupJobDto } from './dto/create-cleanup-job.dto';
import {
    CLEANUP_JOB_CONSTANTS,
    CLEANUP_JOB_MESSAGES,
    CLEANUP_RETRY_DELAYS_MINUTES,
    CLEANUP_MAX_RETRIES,
} from './constants/cleanup-job.constant';
import { toObjectId } from '@/utils/utils';
import {
    CleanupJobActionEnum,
    CleanupJobLockedBy,
    CleanupJobRespone,
    CleanupJobStatusEnum,
} from './types/cleanup-job';
import { Queue } from 'bullmq';

@Injectable()
export class CleanupJobsService {
    constructor(
        @InjectModel(CleanupJob.name)
        private readonly cleanupJobModel: Model<CleanupJobDocument>,

        @Inject(forwardRef(() => MediaService))
        private readonly mediaService: MediaService,

        @Inject(forwardRef(() => SessionService))
        private readonly sessionService: SessionService,

        @Inject(forwardRef(() => RedisService))
        private readonly redisService: RedisService,

        @InjectQueue(CLEANUP_JOB_CONSTANTS.QUEUE_NAME)
        private readonly cleanupJobsQueue: Queue,
    ) {}

    /** Tạo job dọn rác (media claudinaty - R2, session, redis) */
    async createCleanupJob(createDto: CreateCleanupJobDto) {
        const maxRetries =
            CLEANUP_MAX_RETRIES[createDto.action] ??
            CLEANUP_JOB_CONSTANTS.DEFAULT_MAX_RETRIES;
        const cleanupJob = await this.cleanupJobModel.create({
            ...createDto,
            entityId: createDto.entityId
                ? toObjectId(createDto.entityId, 'entityId')
                : undefined,
            maxRetries,
        });

        if (!cleanupJob) {
            throw new BadRequestException(
                CLEANUP_JOB_MESSAGES.FAILED_TO_CREATE_CLEANUP_JOB,
            );
        }

        await this.cleanupJobsQueue.add(
            CLEANUP_JOB_CONSTANTS.JOB_NAME,
            { cleanupJobId: cleanupJob._id.toString() }, // CleanupJobPayload
            {
                jobId: cleanupJob._id.toString(),
                removeOnComplete: true,
                removeOnFail: true,
            },
        );

        return cleanupJob;
    }

    /** Mở khóa các job bị kẹt (lockedUntil đã hết hạn) */
    async unlockStuckJobs(): Promise<number> {
        const result = await this.cleanupJobModel.updateMany(
            {
                lockedUntil: { $lt: new Date() },
                status: {
                    $in: [
                        CleanupJobStatusEnum.PENDING,
                        CleanupJobStatusEnum.RETRY,
                    ],
                },
            },
            {
                $unset: {
                    lockedAt: 1,
                    lockedUntil: 1,
                    lockedBy: 1,
                },
            },
        );
        return result.modifiedCount;
    }

    /** Lấy tất cả job dọn rác, có pagination và sort desc theo creation date */
    async getCleanUpJobs(
        page: number = CLEANUP_JOB_CONSTANTS.DEFAULT_PAGE,
        limit: number = CLEANUP_JOB_CONSTANTS.DEFAULT_LIMIT,
        type?: string,
        status?: string,
        sort?: string,
    ) {
        if (page <= 0 || limit <= 0) {
            throw new BadRequestException(
                CLEANUP_JOB_MESSAGES.GET_CLEANUP_JOBS_PAGINATION_INVALID,
            );
        }

        const filter: any = {};
        if (status && status !== 'all') {
            filter.status = status;
        }
        if (type && type !== 'all') {
            if (type === 'cloud')
                filter.action = { $regex: '^CLOUDINARY', $options: 'i' };
            else if (type === 'r2')
                filter.action = { $regex: '^R2', $options: 'i' };
            else if (type === 'redis')
                filter.action = { $regex: '^REDIS', $options: 'i' };
            else if (type === 'session')
                filter.action = { $regex: '^SESSION', $options: 'i' };
        }

        let sortObj: any = { createdAt: -1, _id: -1 };
        let isAggregate = false;
        let aggregatePipeline: any[] = [];

        if (sort === 'created_asc') {
            sortObj = { createdAt: 1, _id: 1 };
        } else if (sort === 'created_desc') {
            sortObj = { createdAt: -1, _id: -1 };
        } else if (sort === 'retry_asc') {
            isAggregate = true;
            aggregatePipeline = [
                { $match: filter },
                {
                    $addFields: {
                        effectiveExecutionTime: {
                            $switch: {
                                branches: [
                                    {
                                        case: {
                                            $eq: [
                                                '$status',
                                                CleanupJobStatusEnum.PENDING,
                                            ],
                                        },
                                        then: '$createdAt',
                                    },
                                    {
                                        case: {
                                            $eq: [
                                                '$status',
                                                CleanupJobStatusEnum.RETRY,
                                            ],
                                        },
                                        then: '$nextRetryAt',
                                    },
                                ],
                                default: null,
                            },
                        },
                    },
                },
                {
                    $addFields: {
                        hasExecutionTime: {
                            $cond: ['$effectiveExecutionTime', 1, 0],
                        },
                    },
                },
                {
                    $sort: {
                        hasExecutionTime: -1,
                        effectiveExecutionTime: 1,
                        _id: 1,
                    },
                },
                { $skip: (page - 1) * limit },
                { $limit: limit },
            ];
        } else if (sort === 'retry_desc') {
            isAggregate = true;
            aggregatePipeline = [
                { $match: filter },
                {
                    $addFields: {
                        effectiveExecutionTime: {
                            $switch: {
                                branches: [
                                    {
                                        case: {
                                            $eq: [
                                                '$status',
                                                CleanupJobStatusEnum.PENDING,
                                            ],
                                        },
                                        then: '$createdAt',
                                    },
                                    {
                                        case: {
                                            $eq: [
                                                '$status',
                                                CleanupJobStatusEnum.RETRY,
                                            ],
                                        },
                                        then: '$nextRetryAt',
                                    },
                                ],
                                default: null,
                            },
                        },
                    },
                },
                {
                    $addFields: {
                        hasExecutionTime: {
                            $cond: ['$effectiveExecutionTime', 1, 0],
                        },
                    },
                },
                {
                    $sort: {
                        hasExecutionTime: -1,
                        effectiveExecutionTime: -1,
                        _id: -1,
                    },
                },
                { $skip: (page - 1) * limit },
                { $limit: limit },
            ];
        }

        const [totalItems, foundJobs] = await Promise.all([
            this.cleanupJobModel.countDocuments(filter),
            isAggregate
                ? this.cleanupJobModel.aggregate(aggregatePipeline)
                : this.cleanupJobModel
                      .find(filter)
                      .skip((page - 1) * limit)
                      .limit(limit)
                      .sort(sortObj),
        ]);
        const totalPages = Math.ceil(totalItems / limit);
        return {
            cleanupJobs: foundJobs,
            pagination: {
                totalItems,
                totalPages,
                currentPage: page,
                limit,
            },
        } as CleanupJobRespone;
    }

    /** Lấy job dọn rác theo id */
    async getCleanupJobById(jobId: string) {
        const objectId = toObjectId(jobId, 'cleanup job id');
        const cleanupJob = await this.cleanupJobModel
            .findById(objectId)
            .select('-__v')
            .lean();
        if (!cleanupJob) {
            throw new NotFoundException(CLEANUP_JOB_MESSAGES.JOB_NOT_FOUND);
        }
        return cleanupJob as CleanupJob;
    }

    /** Set job thành IGNORED và remove lock */
    async setIgnoreJob(jobId: string) {
        const objectId = toObjectId(jobId, 'job id');
        const cleanupJob = await this.cleanupJobModel.findOneAndUpdate(
            {
                _id: objectId,
                ...this.getRunnableCleanupJobFilter(),
            },
            {
                $set: {
                    status: CleanupJobStatusEnum.IGNORED,
                },
                $unset: {
                    lockedAt: 1,
                    lockedBy: 1,
                    lockedUntil: 1,
                },
            },
            { returnDocument: 'after' },
        );
        if (!cleanupJob) {
            throw new NotFoundException(
                CLEANUP_JOB_MESSAGES.JOB_NOT_FOUND_OR_LOCKED,
            );
        }
        return cleanupJob;
    }

    /** Xử lý job dọn rác (media claudinaty - R2, session, redis) */
    async processCleanupJob(jobId: string, lockedBy: CleanupJobLockedBy) {
        const cleanupJob = await this.getAndLockCleanupJobOrThrow(
            jobId,
            lockedBy,
        );
        try {
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

            return await this.handleCompletedJob(cleanupJob);
        } catch (error) {
            const newRetryCount = cleanupJob.retryCount + 1;
            const hasMoreDelays =
                (CLEANUP_RETRY_DELAYS_MINUTES[cleanupJob.action]?.length ||
                    0) >= newRetryCount;

            if (newRetryCount > cleanupJob.maxRetries || !hasMoreDelays) {
                return await this.handleFailedJob(
                    cleanupJob,
                    (error as Error)?.message || 'Unknown error',
                    cleanupJob.maxRetries,
                );
            }
            return await this.handleRetryJob(
                cleanupJob,
                newRetryCount,
                (error as Error)?.message || 'Unknown error',
            );
        }
    }

    /** Xử lý job xóa 1 ảnh trên cloudinary */
    private async handleCloudinaryDeleteOne(cleanupJob: CleanupJobDocument) {
        const { publicId } = cleanupJob.payload;
        if (!publicId) {
            throw new BadRequestException(
                CLEANUP_JOB_MESSAGES.JOB_INVALID_PAYLOAD_PUBLIC_ID,
            );
        }
        return await this.mediaService.deleteImageFromCloudinary(publicId);
    }

    /** Xử lý job xóa nhiều ảnh trên cloudinary */
    private async handleCloudinaryDeleteMany(cleanupJob: CleanupJobDocument) {
        const { publicIds } = cleanupJob.payload;
        if (!publicIds || !Array.isArray(publicIds) || publicIds.length === 0) {
            throw new BadRequestException(
                CLEANUP_JOB_MESSAGES.JOB_INVALID_PAYLOAD_PUBLIC_IDS,
            );
        }
        return await this.mediaService.deleteImagesFromCloudinary(publicIds);
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

    /** Xử lý job đánh dấu đã hoàn thành */
    private async handleCompletedJob(cleanupJob: CleanupJobDocument) {
        const result = await this.cleanupJobModel.findOneAndUpdate(
            {
                _id: cleanupJob._id,
                status: cleanupJob.status,
                lockedUntil: { $gt: new Date() },
            },
            {
                $set: {
                    status: CleanupJobStatusEnum.DONE,
                    resolvedAt: new Date(),
                },
                $unset: {
                    nextRetryAt: 1,
                    lockedAt: 1,
                    lockedUntil: 1,
                    lockedBy: 1,
                },
            },
            { returnDocument: 'after' },
        );
        if (!result) {
            throw new BadRequestException(
                CLEANUP_JOB_MESSAGES.FAILED_TO_UPDATE_JOB,
            );
        }
        return result;
    }

    /** Xử lý job đánh dấu retry */
    private async handleRetryJob(
        cleanupJob: CleanupJobDocument,
        newRetryCount: number,
        errorMessage?: string,
    ) {
        const nextRetryMinutes =
            CLEANUP_RETRY_DELAYS_MINUTES[cleanupJob.action][newRetryCount - 1];

        const result = await this.cleanupJobModel.findOneAndUpdate(
            {
                _id: cleanupJob._id,
                status: cleanupJob.status,
                lockedUntil: { $gt: new Date() },
            },
            {
                $set: {
                    status: CleanupJobStatusEnum.RETRY,
                    retryCount: newRetryCount,
                    nextRetryAt: new Date(
                        Date.now() + nextRetryMinutes * 60 * 1000,
                    ),
                    error: errorMessage,
                    lastTriedAt: new Date(),
                },
                $unset: {
                    lockedAt: 1,
                    lockedUntil: 1,
                    lockedBy: 1,
                },
            },
            { returnDocument: 'after' },
        );
        if (!result) {
            throw new BadRequestException(
                CLEANUP_JOB_MESSAGES.FAILED_TO_UPDATE_JOB,
            );
        }
        return result;
    }

    /** Xử lý job đánh dấu đã thất bại */
    private async handleFailedJob(
        cleanupJob: CleanupJobDocument,
        errorMessage?: string,
        finalRetryCount?: number,
    ) {
        const updateSet: any = {
            status: CleanupJobStatusEnum.FAILED,
            error: errorMessage,
            lastTriedAt: new Date(),
        };

        if (finalRetryCount !== undefined) {
            updateSet.retryCount = finalRetryCount;
        }

        const result = await this.cleanupJobModel.findOneAndUpdate(
            {
                _id: cleanupJob._id,
                status: cleanupJob.status,
                lockedUntil: { $gt: new Date() },
            },
            {
                $set: updateSet,
                $unset: {
                    nextRetryAt: 1,
                    lockedAt: 1,
                    lockedUntil: 1,
                    lockedBy: 1,
                },
            },
            { returnDocument: 'after' },
        );

        if (!result) {
            throw new BadRequestException(
                CLEANUP_JOB_MESSAGES.FAILED_TO_UPDATE_JOB,
            );
        }
        return result;
    }

    /** Helper - Lấy Cleanup job hoặc ném lỗi nếu không tìm thấy */
    private async getAndLockCleanupJobOrThrow(
        jobId: string,
        lockedBy: CleanupJobLockedBy,
    ) {
        const objectJobId = toObjectId(jobId, 'clean up job id');
        const now = new Date();
        const cleanupJob = await this.cleanupJobModel
            .findOneAndUpdate(
                {
                    _id: objectJobId,
                    ...this.getRunnableCleanupJobFilter(),
                },
                {
                    $set: {
                        lockedBy,
                        lockedAt: now,
                        lockedUntil: new Date(
                            now.getTime() +
                                CLEANUP_JOB_CONSTANTS.LOCK_DURATION_MS,
                        ),
                    },
                },
                { returnDocument: 'after' },
            )
            .lean();
        if (!cleanupJob) {
            throw new NotFoundException(
                CLEANUP_JOB_MESSAGES.JOB_NOT_FOUND_OR_LOCKED,
            );
        }
        return cleanupJob;
    }

    /** Helper - Tạo filter cho các job có thể xử lý (trạng thái PENDING hoặc RETRY và chưa bị lock hoặc lock đã hết hạn) */
    private getRunnableCleanupJobFilter() {
        return {
            status: {
                $in: [CleanupJobStatusEnum.PENDING, CleanupJobStatusEnum.RETRY],
            },
            $or: [
                { lockedUntil: { $exists: false } },
                { lockedUntil: null },
                { lockedUntil: { $lte: new Date() } },
            ],
        };
    }
}
