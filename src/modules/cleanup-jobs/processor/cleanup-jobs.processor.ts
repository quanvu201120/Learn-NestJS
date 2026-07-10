import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { CleanupJobsService } from '../cleanup-jobs.service';
import {
    CleanupJobLockedBy,
    CleanupJobPayload,
    CleanupJobStatusEnum,
} from '../types/cleanup-job';
import { CLEANUP_JOB_CONSTANTS } from '../constants/cleanup-job.constant';

@Injectable()
@Processor(CLEANUP_JOB_CONSTANTS.QUEUE_NAME)
export class CleanupJobsProcessor extends WorkerHost {
    constructor(
        private readonly cleanupJobsService: CleanupJobsService,
        @InjectQueue(CLEANUP_JOB_CONSTANTS.QUEUE_NAME)
        private readonly cleanupJobsQueue: Queue,
    ) {
        super();
    }

    async process(job: Job<CleanupJobPayload>) {
        const result = await this.cleanupJobsService.processCleanupJob(
            job.data.cleanupJobId,
            CleanupJobLockedBy.WORKER,
        );

        if (
            result?.status === CleanupJobStatusEnum.RETRY &&
            result.nextRetryAt
        ) {
            const delay = Math.max(
                result.nextRetryAt.getTime() - Date.now(),
                0,
            );
            await this.cleanupJobsQueue.add(
                CLEANUP_JOB_CONSTANTS.JOB_NAME,
                { cleanupJobId: result._id.toString() },
                {
                    jobId: `${result._id.toString()}-${result.nextRetryAt.getTime()}`,
                    delay,
                    removeOnComplete: true,
                    removeOnFail: true,
                },
            );
        }

        return result;
    }
}
