import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { logCatch } from '@/utils/utils';
import { CleanupJobsService } from '../cleanup-jobs/cleanup-jobs.service';
import { CreateCleanupJobDto } from '../cleanup-jobs/dto/create-cleanup-job.dto';
import {
    CleanupJobActionEnum,
    CleanupJobEntityEnum,
    CleanupJobResourceEnum,
} from '../cleanup-jobs/types/cleanup-job';
import { MediaPersistenceService } from './media-persistence.service';
import { MediaStorageService } from './media-storage.service';
import { CloudinaryDeliveryTypeEnum } from './types/media';

export type MediaCleanupContext = {
    resourceType: CleanupJobResourceEnum;
    entityType: CleanupJobEntityEnum;
    entityId?: string;
};

@Injectable()
export class MediaCleanupService {
    private readonly logger = new Logger(MediaCleanupService.name);

    constructor(
        private readonly mediaPersistenceService: MediaPersistenceService,
        private readonly mediaStorageService: MediaStorageService,
        @Inject(forwardRef(() => CleanupJobsService))
        private readonly cleanupJobsService: CleanupJobsService,
    ) {}

    /**
     * Xóa một ảnh trên Cloudinary theo `publicId` và tạo cleanup job nếu có lỗi.
     */
    async deleteFileFromCloudinaryWithCleanup(
        publicId: string,
        cleanup: MediaCleanupContext,
        deliveryType?: CloudinaryDeliveryTypeEnum,
    ) {
        try {
            return await this.mediaStorageService.deleteFileFromCloudinary(
                publicId,
                deliveryType,
            );
        } catch (error) {
            await this.createCleanupJob({
                resourceType: cleanup.resourceType,
                action: CleanupJobActionEnum.CLOUDINARY_DELETE_ONE,
                entityType: cleanup.entityType,
                entityId: cleanup.entityId,
                payload: {
                    publicId,
                    deliveryType,
                },
                error: (error as Error)?.message,
            });
            return null;
        }
    }

    /**
     * Xóa nhiều ảnh trên Cloudinary theo dạng batch và tạo cleanup job nếu có lỗi.
     */
    async deleteFilesFromCloudinaryWithCleanup(
        publicIds: string[],
        cleanup: MediaCleanupContext,
        deliveryType?: CloudinaryDeliveryTypeEnum,
    ) {
        try {
            return await this.mediaStorageService.deleteFilesFromCloudinary(
                publicIds,
                deliveryType,
            );
        } catch (error) {
            await this.createCleanupJob({
                resourceType: cleanup.resourceType,
                action: CleanupJobActionEnum.CLOUDINARY_DELETE_MANY,
                entityType: cleanup.entityType,
                entityId: cleanup.entityId,
                payload: {
                    publicIds,
                    deliveryType,
                },
                error: (error as Error)?.message,
            });
            return null;
        }
    }

    /**
     * Xóa một file trên R2 theo `objectKey` và tạo cleanup job nếu có lỗi.
     */
    async deleteFileFromR2WithCleanup(
        objectKey: string,
        cleanup: MediaCleanupContext,
    ) {
        try {
            return await this.mediaStorageService.deleteFileFromR2(objectKey);
        } catch (error) {
            await this.createCleanupJob({
                resourceType: cleanup.resourceType,
                action: CleanupJobActionEnum.R2_DELETE_ONE,
                entityType: cleanup.entityType,
                entityId: cleanup.entityId,
                payload: {
                    objectKey,
                },
                error: (error as Error)?.message,
            });
            return null;
        }
    }

    /**
     * Xóa nhiều file trên R2 theo danh sách `objectKey` và tạo cleanup job nếu có lỗi.
     */
    async deleteFilesFromR2WithCleanup(
        objectKeys: string[],
        cleanup: MediaCleanupContext,
    ) {
        try {
            return await this.mediaStorageService.deleteFilesFromR2(objectKeys);
        } catch (error) {
            await this.createCleanupJob({
                resourceType: cleanup.resourceType,
                action: CleanupJobActionEnum.R2_DELETE_MANY,
                entityType: cleanup.entityType,
                entityId: cleanup.entityId,
                payload: {
                    objectKeys,
                },
                error: (error as Error)?.message,
            });
            return null;
        }
    }

    /**
     * Tách media của conversation thành danh sách `publicId` của Cloudinary
     * và `objectKey` của R2 để cleanup sau khi transaction commit thành công.
     */
    async getMediaCleanupKeysByConversation(
        conversationId: string,
        session?: ClientSession,
    ) {
        return await this.mediaPersistenceService.getMediaCleanupKeysByConversation(
            conversationId,
            session,
        );
    }

    private async createCleanupJob(createDto: CreateCleanupJobDto) {
        try {
            await this.cleanupJobsService.createCleanupJob(createDto);
        } catch (error) {
            logCatch(this.logger, 'Failed to create cleanup job', error);
        }
    }
}
