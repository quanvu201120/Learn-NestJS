// src/redis/redis.module.ts
import { forwardRef, Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { CleanupJobsModule } from '@/modules/cleanup-jobs/cleanup-jobs.module';

@Global()
@Module({
    imports: [forwardRef(() => CleanupJobsModule)],
    providers: [RedisService],
    exports: [RedisService],
})
export class RedisModule {}
