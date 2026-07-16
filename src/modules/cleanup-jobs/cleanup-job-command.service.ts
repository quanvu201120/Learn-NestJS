/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Queue } from 'bullmq';
import { Model } from 'mongoose';
import {
    CLEANUP_JOB_CONSTANTS,
    CLEANUP_JOB_MESSAGES,
    CLEANUP_MAX_RETRIES,
    CLEANUP_RETRY_DELAYS_MINUTES,
} from './constants/cleanup-job.constant';
import { CreateCleanupJobDto } from './dto/create-cleanup-job.dto';
import { CleanupJob, CleanupJobDocument } from './schemas/cleanup-job.schema';
import { CleanupJobLockedBy, CleanupJobStatusEnum } from './types/cleanup-job';
import { toObjectId } from '@/utils/utils';

@Injectable()
export class CleanupJobCommandService {
    constructor(
        @InjectModel(CleanupJob.name)
        private readonly cleanupJobModel: Model<CleanupJobDocument>,

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

    /** Xử lý job đánh dấu đã hoàn thành */
    async handleCompletedJob(cleanupJob: CleanupJobDocument) {
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
    async handleRetryJob(
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
    async handleFailedJob(
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
    async getAndLockCleanupJobOrThrow(
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
