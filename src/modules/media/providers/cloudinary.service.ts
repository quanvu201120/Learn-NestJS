/* eslint-disable @typescript-eslint/prefer-promise-reject-errors */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import {
    CloudinaryDeliveryTypeEnum,
    MediaProviderEnum,
    MediaResourceTypeEnum,
    OwnerTypeEnum,
} from '../types/media';
import { Media } from '../schemas/media.schema';
import { Types } from 'mongoose';
import { MEDIA_CONSTANTS } from '../constants/media.constant';

@Injectable()
export class CloudinaryService {
    // Có bật auth_token (TTL thật) hay không. Chỉ khả dụng ở gói Cloudinary trả phí.
    private readonly authTokenEnabled: boolean;
    private readonly authTokenKey?: string;

    constructor(private readonly configService: ConfigService) {
        this.authTokenKey = this.configService.get<string>(
            'CLOUDINARY_AUTH_TOKEN_KEY',
        );
        this.authTokenEnabled =
            this.configService.get<string>('CLOUDINARY_AUTH_TOKEN_ENABLED') ===
                'true' && !!this.authTokenKey;

        cloudinary.config({
            cloud_name: this.configService.get<string>('CLOUDINARY_CLOUD_NAME'),
            api_key: this.configService.get<string>('CLOUDINARY_API_KEY'),
            api_secret: this.configService.get<string>('CLOUDINARY_API_SECRET'),
            secure: true,
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
    async resourceExists(
        publicId: string,
        deliveryType: CloudinaryDeliveryTypeEnum = CloudinaryDeliveryTypeEnum.UPLOAD,
    ) {
        try {
            await cloudinary.api.resource(publicId, {
                resource_type: 'image',
                type: deliveryType,
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
     *
     * `isPrivate = true` → upload dạng `authenticated`: ảnh không thể truy cập nếu
     * không có chữ ký hợp lệ, và không lưu `url` sẵn (phải ký mỗi lần trả về).
     */
    async uploadFile(
        uploadedBy: Types.ObjectId,
        ownerType: OwnerTypeEnum,
        ownerId: Types.ObjectId,
        file: Express.Multer.File,
        folder: string,
        isPrivate = false,
    ): Promise<Media> {
        const deliveryType = isPrivate
            ? CloudinaryDeliveryTypeEnum.AUTHENTICATED
            : CloudinaryDeliveryTypeEnum.UPLOAD;

        return await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                {
                    folder,
                    resource_type: 'image',
                    type: deliveryType,
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
                            deliveryType,
                        ),
                    );
                },
            );

            stream.end(file.buffer);
        });
    }

    /**
     * Tạo signed URL cho ảnh `authenticated`. Đồng bộ (không gọi mạng),
     * tính cục bộ bằng `CLOUDINARY_API_SECRET`.
     *
     * Khi `auth_token` được bật (gói trả phí) → URL có TTL thật (hết hạn sau `ttlSeconds`).
     * Free tier → chỉ ký chặn đoán link, KHÔNG có TTL.
     */
    getSignedFileUrl(
        publicId: string,
        ttlSeconds: number = MEDIA_CONSTANTS.SIGNED_URL_TTL_SECONDS,
    ): string {
        const options: Record<string, any> = {
            resource_type: 'image',
            type: CloudinaryDeliveryTypeEnum.AUTHENTICATED,
            sign_url: true,
            secure: true,
        };

        if (this.authTokenEnabled) {
            options.auth_token = {
                key: this.authTokenKey,
                duration: ttlSeconds,
            };
        }

        return cloudinary.url(publicId, options);
    }

    /**
     * Xóa một resource ảnh trên Cloudinary. Cần đúng `deliveryType` vì Cloudinary
     * mặc định xóa theo type `upload`; xóa ảnh `authenticated` mà không khai báo
     * type sẽ báo thành công nhưng không xóa gì.
     */
    async deleteResource(
        publicId: string,
        deliveryType: CloudinaryDeliveryTypeEnum = CloudinaryDeliveryTypeEnum.UPLOAD,
    ): Promise<void> {
        await cloudinary.uploader.destroy(publicId, {
            resource_type: 'image',
            type: deliveryType,
        });
    }

    /**
     * Xóa nhiều resource ảnh trên Cloudinary trong một request. Vì Cloudinary
     * `delete_resources` chỉ nhận một `type` cho cả batch, các publicId phải cùng
     * `deliveryType`; caller chịu trách nhiệm tách batch theo type trước khi gọi.
     */
    async deleteResources(
        publicIds: string[],
        deliveryType: CloudinaryDeliveryTypeEnum = CloudinaryDeliveryTypeEnum.UPLOAD,
    ): Promise<void> {
        const uniquePublicIds = [...new Set(publicIds.filter(Boolean))];

        if (uniquePublicIds.length === 0) {
            return;
        }

        await cloudinary.api.delete_resources(uniquePublicIds, {
            resource_type: 'image',
            type: deliveryType,
        });
    }

    /**
     * Chuyển response upload của Cloudinary thành payload media để lưu trong hệ thống.
     * Với ảnh `authenticated`, KHÔNG lưu `url` (secure_url không dùng trực tiếp được);
     * serializer sẽ ký URL khi trả về client.
     */
    private mapUploadResult(
        uploadedBy: Types.ObjectId,
        ownerType: OwnerTypeEnum,
        ownerId: Types.ObjectId,
        file: Express.Multer.File,
        result: UploadApiResponse,
        deliveryType: CloudinaryDeliveryTypeEnum,
    ): Media {
        const isPrivate =
            deliveryType === CloudinaryDeliveryTypeEnum.AUTHENTICATED;

        return {
            uploadedBy,
            ownerType,
            ownerId,
            provider: MediaProviderEnum.CLOUDINARY,
            resourceType: MediaResourceTypeEnum.IMAGE,
            url: isPrivate ? undefined : result.secure_url,
            publicId: result.public_id,
            deliveryType,
            fileName: file.originalname,
            mimeType: file.mimetype,
            size: result.bytes,
            width: result.width,
            height: result.height,
        };
    }
}
