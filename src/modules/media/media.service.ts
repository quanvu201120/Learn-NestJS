import { Injectable } from '@nestjs/common';
import { ClientSession, Types } from 'mongoose';
import { Media } from './schemas/media.schema';
import { MediaResourceTypeEnum, OwnerTypeEnum } from './types/media';
import {
    MediaCleanupContext,
    MediaCleanupService,
} from './media-cleanup.service';
import { MediaDownloadService } from './media-download.service';
import { MediaPersistenceService } from './media-persistence.service';
import { MediaQueryService } from './media-query.service';
import { MediaStorageService } from './media-storage.service';

@Injectable()
export class MediaService {
    constructor(
        private readonly mediaPersistenceService: MediaPersistenceService,
        private readonly mediaQueryService: MediaQueryService,
        private readonly mediaStorageService: MediaStorageService,
        private readonly mediaCleanupService: MediaCleanupService,
        private readonly mediaDownloadService: MediaDownloadService,
    ) {}

    /**
     * Lưu một bản ghi media vào MongoDB và hỗ trợ gắn vào transaction có sẵn nếu cần.
     */
    async createMedia(media: Media, session?: ClientSession) {
        return await this.mediaPersistenceService.createMedia(media, session);
    }

    /**
     * Tìm document media theo id.
     */
    async findById(id: string, session?: ClientSession) {
        return await this.mediaPersistenceService.findById(id, session);
    }

    async getMediasByConversation(
        conversationId: string,
        userId: string,
        type: MediaResourceTypeEnum,
        cursor?: string,
        session?: ClientSession,
    ) {
        return await this.mediaQueryService.getMediasByConversation(
            conversationId,
            userId,
            type,
            cursor,
            session,
        );
    }

    /**
     * Download file media từ R2 theo id và kiểm tra quyền truy cập.
     */
    async downloadR2Media(id: string, userId: string) {
        return await this.mediaDownloadService.downloadR2Media(id, userId);
    }

    /**
     * Lấy các khóa định danh storage cần thiết để cleanup media của một conversation.
     */
    async getKeysMediaByConversation(
        conversationId: string,
        session?: ClientSession,
    ) {
        return await this.mediaPersistenceService.getKeysMediaByConversation(
            conversationId,
            session,
        );
    }

    /**
     * Xóa toàn bộ bản ghi media thuộc về một conversation khỏi MongoDB.
     */
    async deleteAllMediaByConversation(
        conversationId: string,
        session?: ClientSession,
    ) {
        return await this.mediaPersistenceService.deleteAllMediaByConversation(
            conversationId,
            session,
        );
    }

    /**
     * Xóa một bản ghi media khỏi MongoDB.
     */
    async deleteMedia(id: string, session?: ClientSession) {
        return await this.mediaPersistenceService.deleteMedia(id, session);
    }

    /**
     * Upload ảnh lên Cloudinary và trả về payload media sẵn sàng để lưu MongoDB.
     */
    async uploadImageToCloudinary(
        uploadedBy: Types.ObjectId,
        ownerType: OwnerTypeEnum,
        ownerId: Types.ObjectId,
        file: Express.Multer.File,
        folder: string,
    ) {
        return await this.mediaStorageService.uploadImageToCloudinary(
            uploadedBy,
            ownerType,
            ownerId,
            file,
            folder,
        );
    }

    /**
     * Xóa một ảnh trên Cloudinary theo `publicId`.
     */
    async deleteImageFromCloudinary(publicId: string) {
        return await this.mediaStorageService.deleteImageFromCloudinary(
            publicId,
        );
    }

    /**
     * Xóa một ảnh trên Cloudinary theo `publicId` và tạo cleanup job nếu có lỗi.
     */
    async deleteImageFromCloudinaryWithCleanup(
        publicId: string,
        cleanup: MediaCleanupContext,
    ) {
        return await this.mediaCleanupService.deleteImageFromCloudinaryWithCleanup(
            publicId,
            cleanup,
        );
    }

    /**
     * Xóa nhiều ảnh trên Cloudinary theo dạng batch.
     */
    async deleteImagesFromCloudinary(publicIds: string[]) {
        return await this.mediaStorageService.deleteImagesFromCloudinary(
            publicIds,
        );
    }

    /**
     * Xóa nhiều ảnh trên Cloudinary theo dạng batch và tạo cleanup job nếu có lỗi.
     */
    async deleteImagesFromCloudinaryWithCleanup(
        publicIds: string[],
        cleanup: MediaCleanupContext,
    ) {
        return await this.mediaCleanupService.deleteImagesFromCloudinaryWithCleanup(
            publicIds,
            cleanup,
        );
    }

    /**
     * Upload file không phải ảnh lên R2 và trả về metadata để lưu vào MongoDB.
     */
    async uploadFileToR2(
        uploadedBy: Types.ObjectId,
        ownerType: OwnerTypeEnum,
        ownerId: Types.ObjectId,
        file: Express.Multer.File,
        resourceType: MediaResourceTypeEnum,
        folder: string,
    ) {
        return await this.mediaStorageService.uploadFileToR2(
            uploadedBy,
            ownerType,
            ownerId,
            file,
            resourceType,
            folder,
        );
    }

    /**
     * Xóa một file trên R2 theo `objectKey`.
     */
    async deleteFileFromR2(objectKey: string) {
        return await this.mediaStorageService.deleteFileFromR2(objectKey);
    }

    /**
     * Xóa một file trên R2 theo `objectKey` và tạo cleanup job nếu có lỗi.
     */
    async deleteFileFromR2WithCleanup(
        objectKey: string,
        cleanup: MediaCleanupContext,
    ) {
        return await this.mediaCleanupService.deleteFileFromR2WithCleanup(
            objectKey,
            cleanup,
        );
    }

    /**
     * Xóa nhiều file trên R2 theo danh sách `objectKey`.
     */
    async deleteFilesFromR2(objectKeys: string[]) {
        return await this.mediaStorageService.deleteFilesFromR2(objectKeys);
    }

    /**
     * Xóa nhiều file trên R2 theo danh sách `objectKey` và tạo cleanup job nếu có lỗi.
     */
    async deleteFilesFromR2WithCleanup(
        objectKeys: string[],
        cleanup: MediaCleanupContext,
    ) {
        return await this.mediaCleanupService.deleteFilesFromR2WithCleanup(
            objectKeys,
            cleanup,
        );
    }

    /**
     * Tách media của conversation thành danh sách `publicId` của Cloudinary
     * và `objectKey` của R2 để cleanup sau khi transaction commit thành công.
     */
    async getMediaCleanupKeysByConversation(
        conversationId: string,
        session?: ClientSession,
    ) {
        return await this.mediaCleanupService.getMediaCleanupKeysByConversation(
            conversationId,
            session,
        );
    }

    /**
     * Xoá mềm media khi xoá tin nhắn.
     *  -> đảm bảo media đã bị xoá sẽ không được sử dụng lại.
     */
    async softDeleteMediaWithMessage(
        mediaId: string,
        conversationId: string,
        session?: ClientSession,
    ) {
        return await this.mediaPersistenceService.softDeleteMediaWithMessage(
            mediaId,
            conversationId,
            session,
        );
    }
}
