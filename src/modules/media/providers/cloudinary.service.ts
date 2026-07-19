/* eslint-disable @typescript-eslint/prefer-promise-reject-errors */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import {
    MediaProviderEnum,
    MediaResourceTypeEnum,
    OwnerTypeEnum,
} from '../types/media';
import { Media } from '../schemas/media.schema';
import { Types } from 'mongoose';

@Injectable()
export class CloudinaryService {
    constructor(private readonly configService: ConfigService) {
        cloudinary.config({
            cloud_name: this.configService.get<string>('CLOUDINARY_CLOUD_NAME'),
            api_key: this.configService.get<string>('CLOUDINARY_API_KEY'),
            api_secret: this.configService.get<string>('CLOUDINARY_API_SECRET'),
        });
    }

    /**
     * Kiểm tra nhanh kết nối với Cloudinary khi cần debug hoặc chẩn đoán.
     */
    async ping() {
        return await cloudinary.api.ping();
    }

    /**
     * Lấy thông tin usage (bandwidth, storage) từ Cloudinary cho chu kỳ hiện tại.
     */
    async getUsage() {
        return await cloudinary.api.usage();
    }

    /**
     * Kiểm tra resource có tồn tại trên Cloudinary hay không.
     */
    async resourceExists(publicId: string) {
        try {
            await cloudinary.api.resource(publicId, {
                resource_type: 'image',
            });
            return true;
        } catch (error) {
            if ((error as { http_code?: number }).http_code === 404) {
                return false;
            }
            throw error;
        }
    }

    /**
     * Stream buffer ảnh lên Cloudinary và map kết quả trả về
     * thành shape media mà ứng dụng đang dùng.
     */
    async uploadImage(
        uploadedBy: Types.ObjectId,
        ownerType: OwnerTypeEnum,
        ownerId: Types.ObjectId,
        file: Express.Multer.File,
        folder: string,
    ): Promise<Media> {
        return await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                {
                    folder,
                    resource_type: 'image',
                },
                (error, result) => {
                    if (error || !result) {
                        return reject(error ?? new Error('Upload failed'));
                    }

                    resolve(
                        this.mapUploadResult(
                            uploadedBy,
                            ownerType,
                            ownerId,
                            file,
                            result,
                        ),
                    );
                },
            );

            stream.end(file.buffer);
        });
    }

    /**
     * Xóa một resource ảnh trên Cloudinary.
     */
    async deleteResource(publicId: string): Promise<void> {
        await cloudinary.uploader.destroy(publicId, {
            resource_type: 'image',
        });
    }

    /**
     * Xóa nhiều resource ảnh trên Cloudinary trong một request.
     */
    async deleteResources(publicIds: string[]): Promise<void> {
        const uniquePublicIds = [...new Set(publicIds.filter(Boolean))];

        if (uniquePublicIds.length === 0) {
            return;
        }

        await cloudinary.api.delete_resources(uniquePublicIds, {
            resource_type: 'image',
        });
    }

    /**
     * Chuyển response upload của Cloudinary thành payload media để lưu trong hệ thống.
     */
    private mapUploadResult(
        uploadedBy: Types.ObjectId,
        ownerType: OwnerTypeEnum,
        ownerId: Types.ObjectId,
        file: Express.Multer.File,
        result: UploadApiResponse,
    ): Media {
        return {
            uploadedBy,
            ownerType,
            ownerId,
            provider: MediaProviderEnum.CLOUDINARY,
            resourceType: MediaResourceTypeEnum.IMAGE,
            url: result.secure_url,
            publicId: result.public_id,
            fileName: file.originalname,
            mimeType: file.mimetype,
            size: result.bytes,
            width: result.width,
            height: result.height,
        };
    }
}
