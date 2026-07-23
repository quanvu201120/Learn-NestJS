import { BadRequestException, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { CloudinaryService } from './providers/cloudinary.service';
import { R2Service } from './providers/r2.service';
import { Media } from './schemas/media.schema';
import {
    CloudinaryDeliveryTypeEnum,
    MediaProviderEnum,
    MediaResourceTypeEnum,
    OwnerTypeEnum,
} from './types/media';
import { MEDIA_MESSAGES } from './constants/media.constant';

@Injectable()
export class MediaStorageService {
    constructor(
        private readonly cloudinaryService: CloudinaryService,
        private readonly r2Service: R2Service,
    ) {}

    /**
     * Upload ảnh lên Cloudinary và trả về payload media sẵn sàng để lưu MongoDB.
     */
    async uploadFileToCloudinary(
        uploadedBy: Types.ObjectId,
        ownerType: OwnerTypeEnum,
        ownerId: Types.ObjectId,
        file: Express.Multer.File,
        folder: string,
        isPrivate = false,
    ) {
        return await this.cloudinaryService.uploadFile(
            uploadedBy,
            ownerType,
            ownerId,
            file,
            folder,
            isPrivate,
        );
    }

    /**
     * Tạo signed URL cho ảnh Cloudinary `authenticated`.
     */
    getSignedFileUrl(publicId: string, ttlSeconds?: number) {
        return this.cloudinaryService.getSignedFileUrl(publicId, ttlSeconds);
    }

    /**
     * Xóa một ảnh trên Cloudinary theo `publicId` và `deliveryType`.
     */
    async deleteFileFromCloudinary(
        publicId: string,
        deliveryType?: CloudinaryDeliveryTypeEnum,
    ) {
        return await this.cloudinaryService.deleteResource(
            publicId,
            deliveryType,
        );
    }

    /**
     * Xóa nhiều ảnh trên Cloudinary theo dạng batch (cùng `deliveryType`).
     */
    async deleteFilesFromCloudinary(
        publicIds: string[],
        deliveryType?: CloudinaryDeliveryTypeEnum,
    ) {
        return await this.cloudinaryService.deleteResources(
            publicIds,
            deliveryType,
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
        const uploadedFile = await this.r2Service.uploadObject(file, folder);
        if (!uploadedFile) {
            throw new BadRequestException(MEDIA_MESSAGES.MEDIA_CREATE_FAILED);
        }
        const result: Media = {
            uploadedBy,
            ownerType,
            ownerId,
            provider: MediaProviderEnum.R2,
            resourceType,
            objectKey: uploadedFile.objectKey,
            fileName: uploadedFile.fileName,
            mimeType: uploadedFile.mimeType,
            size: uploadedFile.size,
        };
        return result;
    }

    /**
     * Xóa một file trên R2 theo `objectKey`.
     */
    async deleteFileFromR2(objectKey: string) {
        return await this.r2Service.deleteObject(objectKey);
    }

    /**
     * Xóa nhiều file trên R2 theo danh sách `objectKey`.
     */
    async deleteFilesFromR2(objectKeys: string[]) {
        return await this.r2Service.deleteObjects(objectKeys);
    }

    async getR2Object(objectKey: string) {
        return await this.r2Service.getObject(objectKey);
    }
}
