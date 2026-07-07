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
    CleanupJobLockedBy,
    CleanupJobResourceEnum,
    CleanupJobStatusEnum,
} from './types/cleanup-job';
import { RolesGuard } from '@/auth/passport/roles.guard';
import { Roles } from '@/utils/decorator-customize';
import { UserRole } from '@/modules/users/types/user';

@Controller('cleanup-jobs')
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@UseGuards(RolesGuard)
export class CleanupJobsController {
    constructor(private readonly cleanupJobsService: CleanupJobsService) {}

    @Post('test/cloudinary')
    @UseInterceptors(FileInterceptor('file'))
    async createCloudinaryCleanupJobTest(
        @UploadedFile() file: Express.Multer.File,
    ) {
        if (!file) {
            throw new BadRequestException('File is required');
        }

        return await this.cleanupJobsService.createCleanupJob({
            resourceType: CleanupJobResourceEnum.USER_AVATAR,
            action: CleanupJobActionEnum.CLOUDINARY_DELETE_ONE,
            entityType: CleanupJobEntityEnum.USER,
            payload: {
                publicId: `test/cloudinary-missing-${Date.now()}`,
            },
            error: 'Manual test cleanup job for Cloudinary',
        });
    }

    @Post('test/r2')
    @UseInterceptors(FileInterceptor('file'))
    async createR2CleanupJobTest(@UploadedFile() file: Express.Multer.File) {
        if (!file) {
            throw new BadRequestException('File is required');
        }

        return await this.cleanupJobsService.createCleanupJob({
            resourceType: CleanupJobResourceEnum.MESSAGE_MEDIA,
            action: CleanupJobActionEnum.R2_DELETE_ONE,
            entityType: CleanupJobEntityEnum.MESSAGE,
            payload: {
                objectKey: `test/r2-missing-${Date.now()}`,
            },
            error: 'Manual test cleanup job for R2',
        });
    }

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
        throw new BadRequestException('Status not supported via this endpoint');
    }
}
