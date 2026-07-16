/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
    BadRequestException,
    Controller,
    Get,
    Param,
    Patch,
    Post,
    Query,
    Request,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CleanupJobsService } from './cleanup-jobs.service';
import {
    CleanupJobActionEnum,
    CleanupJobEntityEnum,
    CleanupJobResourceEnum,
    CleanupJobStatusEnum,
} from './types/cleanup-job';
import { RolesGuard } from '@/auth/passport/roles.guard';
import { Roles } from '@/utils/decorator-customize';
import { UserRole } from '@/modules/users/types/user';
import { CLEANUP_JOB_MESSAGES } from './constants/cleanup-job.constant';
import { VALIDATION_MESSAGES } from '@/common/constants/validation.constant';
import { MediaService } from '../media/media.service';
import { MediaResourceTypeEnum, OwnerTypeEnum } from '../media/types/media';
import { Types } from 'mongoose';

@Controller('cleanup-jobs')
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@UseGuards(RolesGuard)
export class CleanupJobsController {
    constructor(
        private readonly cleanupJobsService: CleanupJobsService,
        private readonly mediaService: MediaService,
    ) {}

    @Get()
    async getCleanUpJobs(
        @Query('page') page?: number,
        @Query('limit') limit?: number,
        @Query('type') type?: string,
        @Query('status') status?: string,
        @Query('sort') sort?: string,
    ) {
        return await this.cleanupJobsService.getCleanUpJobs(
            page,
            limit,
            type,
            status,
            sort,
        );
    }

    @Get('/:id')
    async getCleanupJobById(@Param('id') jobId: string) {
        return await this.cleanupJobsService.getCleanupJobById(jobId);
    }

    @Patch('process/:id')
    async processCleanupJob(@Param('id') jobId: string, @Request() req) {
        return await this.cleanupJobsService.processCleanupJob(
            jobId,
            req.user.role,
        );
    }

    @Patch(':id/status')
    async updateCleanupJobStatus(
        @Param('id') jobId: string,
        @Query('status') status: CleanupJobStatusEnum,
    ) {
        if (status === CleanupJobStatusEnum.IGNORED) {
            return await this.cleanupJobsService.setIgnoreJob(jobId);
        }
        // Có thể mở rộng cho các status khác nếu service hỗ trợ
        throw new BadRequestException(
            CLEANUP_JOB_MESSAGES.STATUS_NOT_SUPPORTED,
        );
    }
}
