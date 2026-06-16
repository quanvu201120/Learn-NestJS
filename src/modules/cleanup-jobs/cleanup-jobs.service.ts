import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { CleanupJob, CleanupJobDocument } from './schemas/cleanup-job.schema';
import { Model } from 'mongoose';
import { SessionService } from '../session/session.service';
import { MediaService } from '../media/media.service';
import { RedisService } from '@/redis/redis.service';
import { CreateCleanupJobDto } from './dto/create-cleanup-job.dto';
import { CLEANUP_JOB_MESSAGES } from './constants/cleanup-job.constant';

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
    ) {}

    async createCleanupJob(createDto: CreateCleanupJobDto) {
        const cleanupJob = await this.cleanupJobModel.create(createDto);

        if (!cleanupJob) {
            throw new Error(CLEANUP_JOB_MESSAGES.FAILED_TO_CREATE_CLEANUP_JOB);
        }
        return cleanupJob;
    }
}
