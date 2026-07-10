import { forwardRef, Module } from '@nestjs/common';
import { CleanupJobsService } from './cleanup-jobs.service';
import { CleanupJobsController } from './cleanup-jobs.controller';
import { MediaModule } from '../media/media.module';
import { RedisModule } from '@/redis/redis.module';
import { SessionModule } from '../session/session.module';
import { CleanupJob, CleanupJobSchema } from './schemas/cleanup-job.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { CleanupJobsCron } from './cron/cleanup-jobs.cron';
import { BullModule } from '@nestjs/bullmq';
import { CLEANUP_JOB_CONSTANTS } from './constants/cleanup-job.constant';
import { CleanupJobsProcessor } from './processor/cleanup-jobs.processor';

@Module({
    imports: [
        MongooseModule.forFeature([
            {
                name: CleanupJob.name,
                schema: CleanupJobSchema,
            },
        ]),
        forwardRef(() => MediaModule),
        forwardRef(() => RedisModule),
        forwardRef(() => SessionModule),
        BullModule.registerQueue({
            name: CLEANUP_JOB_CONSTANTS.QUEUE_NAME,
        }),
    ],
    controllers: [CleanupJobsController],
    providers: [CleanupJobsService, CleanupJobsCron, CleanupJobsProcessor],
    exports: [CleanupJobsService],
})
export class CleanupJobsModule {}
