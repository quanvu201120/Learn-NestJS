import { forwardRef, Module } from '@nestjs/common';
import { CleanupJobsService } from './cleanup-jobs.service';
import { CleanupJobsController } from './cleanup-jobs.controller';
import { MediaModule } from '../media/media.module';
import { RedisModule } from '@/redis/redis.module';
import { SessionModule } from '../session/session.module';
import { CleanupJob, CleanupJobSchema } from './schemas/cleanup-job.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { CleanupJobsCron } from './cron/cleanup-jobs.cron';

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
    ],
    controllers: [CleanupJobsController],
    providers: [CleanupJobsService, CleanupJobsCron],
    exports: [CleanupJobsService],
})
export class CleanupJobsModule {}
