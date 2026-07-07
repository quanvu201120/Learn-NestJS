import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CleanupJobsService } from '../cleanup-jobs.service';

@Injectable()
export class CleanupJobsCron {
    private readonly logger = new Logger(CleanupJobsCron.name);

    constructor(private readonly cleanupJobsService: CleanupJobsService) {}

    /**
     * Chạy mỗi 15 phút để tìm các job đang bị kẹt ở trạng thái locked
     * (tức là lockedUntil < Date.now()) và gỡ lock cho chúng.
     */
    @Cron('0 */15 * * * *')
    async unlockStuckJobs() {
        try {
            await this.cleanupJobsService.unlockStuckJobs();
        } catch (error) {
            this.logger.error(
                'Lỗi khi thực thi cron job unlockStuckJobs:',
                error,
            );
        }
    }
}
