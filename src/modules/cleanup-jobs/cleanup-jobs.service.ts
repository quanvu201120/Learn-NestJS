import { Injectable } from '@nestjs/common';
import { CreateCleanupJobDto } from './dto/create-cleanup-job.dto';
import {
    CLEANUP_JOB_CONSTANTS,
    CLEANUP_RETRY_DELAYS_MINUTES,
} from './constants/cleanup-job.constant';
import { CleanupJobLockedBy } from './types/cleanup-job';
import { CleanupJobCommandService } from './cleanup-job-command.service';
import { CleanupJobDispatcherService } from './cleanup-job-dispatcher.service';
import { CleanupJobQueryService } from './cleanup-job-query.service';

@Injectable()
export class CleanupJobsService {
    constructor(
        private readonly cleanupJobCommandService: CleanupJobCommandService,
        private readonly cleanupJobDispatcherService: CleanupJobDispatcherService,
        private readonly cleanupJobQueryService: CleanupJobQueryService,
    ) {}

    /** Tạo job dọn rác (media claudinaty - R2, session, redis) */
    async createCleanupJob(createDto: CreateCleanupJobDto) {
        return await this.cleanupJobCommandService.createCleanupJob(createDto);
    }

    /** Mở khóa các job bị kẹt (lockedUntil đã hết hạn) */
    async unlockStuckJobs(): Promise<number> {
        return await this.cleanupJobCommandService.unlockStuckJobs();
    }

    /** Lấy tất cả job dọn rác, có pagination và sort desc theo creation date */
    async getCleanUpJobs(
        page: number = CLEANUP_JOB_CONSTANTS.DEFAULT_PAGE,
        limit: number = CLEANUP_JOB_CONSTANTS.DEFAULT_LIMIT,
        type?: string,
        status?: string,
        sort?: string,
    ) {
        return await this.cleanupJobQueryService.getCleanUpJobs(
            page,
            limit,
            type,
            status,
            sort,
        );
    }

    /** Lấy job dọn rác theo id */
    async getCleanupJobById(jobId: string) {
        return await this.cleanupJobQueryService.getCleanupJobById(jobId);
    }

    /** Set job thành IGNORED và remove lock */
    async setIgnoreJob(jobId: string) {
        return await this.cleanupJobCommandService.setIgnoreJob(jobId);
    }

    /** Xử lý job dọn rác (media claudinaty - R2, session, redis) */
    async processCleanupJob(jobId: string, lockedBy: CleanupJobLockedBy) {
        const cleanupJob =
            await this.cleanupJobCommandService.getAndLockCleanupJobOrThrow(
                jobId,
                lockedBy,
            );
        try {
            await this.cleanupJobDispatcherService.dispatch(cleanupJob);

            return await this.cleanupJobCommandService.handleCompletedJob(
                cleanupJob,
            );
        } catch (error) {
            const newRetryCount = cleanupJob.retryCount + 1;
            const hasMoreDelays =
                (CLEANUP_RETRY_DELAYS_MINUTES[cleanupJob.action]?.length ||
                    0) >= newRetryCount;

            if (newRetryCount > cleanupJob.maxRetries || !hasMoreDelays) {
                return await this.cleanupJobCommandService.handleFailedJob(
                    cleanupJob,
                    (error as Error)?.message || 'Unknown error',
                    cleanupJob.maxRetries,
                );
            }
            return await this.cleanupJobCommandService.handleRetryJob(
                cleanupJob,
                newRetryCount,
                (error as Error)?.message || 'Unknown error',
            );
        }
    }
}
