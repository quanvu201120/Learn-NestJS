/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
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

    async ping() {
        return await cloudinary.api.ping();
    }

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

    async deleteResource(publicId: string): Promise<void> {
        await cloudinary.uploader.destroy(publicId, {
            resource_type: 'image',
        });
    }

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
