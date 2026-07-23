/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { Types } from 'mongoose';
import { v2 as cloudinary } from 'cloudinary';
import {
    CloudinaryDeliveryTypeEnum,
    MediaProviderEnum,
    MediaResponse,
} from '../types/media';
import { MEDIA_CONSTANTS } from '../constants/media.constant';
import { buildR2SignedUrl } from './r2-presign.util';

/**
 * Chuyển `objectKey` của file lưu trên R2 thành URL ĐÃ KÝ (presigned) có TTL ngắn
 * để trả về cho client. Bucket R2 để private → chỉ URL ký hợp lệ mới truy cập được,
 * và URL hết hạn sau `SIGNED_URL_TTL_SECONDS` (client xin lại qua `/media/:id/url`).
 */
export const buildR2MediaUrl = (objectKey: string) => {
    return buildR2SignedUrl(objectKey);
};

/**
 * Có bật Cloudinary auth_token (TTL thật) hay không. Chỉ khả dụng ở gói trả phí.
 * Đọc trực tiếp process.env để serializer giữ được dạng hàm thuần (không cần DI).
 */
const isAuthTokenEnabled = () =>
    process.env.CLOUDINARY_AUTH_TOKEN_ENABLED === 'true' &&
    !!process.env.CLOUDINARY_AUTH_TOKEN_KEY;

/**
 * Ký URL cho file Cloudinary `authenticated`.
 * Khi auth_token bật (trả phí) → URL có TTL thật (hết hạn sau SIGNED_URL_TTL_SECONDS).
 * Free tier → chỉ ký chặn đoán link, KHÔNG có TTL.
 */
export const signCloudinaryAuthenticatedUrl = (publicId: string): string => {
    const options: Record<string, any> = {
        resource_type: 'image',
        type: CloudinaryDeliveryTypeEnum.AUTHENTICATED,
        sign_url: true,
        secure: true,
    };

    if (isAuthTokenEnabled()) {
        options.auth_token = {
            key: process.env.CLOUDINARY_AUTH_TOKEN_KEY,
            duration: MEDIA_CONSTANTS.SIGNED_URL_TTL_SECONDS,
        };
    }

    return cloudinary.url(publicId, options);
};

/**
 * Xác định media Cloudinary có phải dạng riêng tư (authenticated) cần ký hay không.
 * Ưu tiên field `deliveryType`; fallback không có `url` nhưng có
 * `publicId` cũng coi là cần ký.
 */
const isCloudinaryAuthenticated = (media: any) => {
    if (media.deliveryType === CloudinaryDeliveryTypeEnum.AUTHENTICATED) {
        return true;
    }
    if (media.deliveryType === CloudinaryDeliveryTypeEnum.UPLOAD) {
        return false;
    }
    return !media.url && !!media.publicId;
};

/**
 * Chuẩn hóa field media trước khi trả về API.
 * Hỗ trợ cả document đã populate, ObjectId hoặc string id thô.
 */
export const serializeMedia = (media: any): MediaResponse | any => {
    if (
        !media ||
        typeof media !== 'object' ||
        media instanceof Types.ObjectId ||
        !Object.keys(media).includes('_id')
    ) {
        return media ? media.toString() : media;
    }

    const serializedMedia = {
        ...media,
        _id: media._id ? media._id.toString() : undefined,
    };

    if (serializedMedia.provider === MediaProviderEnum.R2) {
        serializedMedia.url = buildR2MediaUrl(serializedMedia.objectKey);
        if (serializedMedia.url) {
            serializedMedia.expiresAt = new Date(
                Date.now() + MEDIA_CONSTANTS.SIGNED_URL_TTL_SECONDS * 1000,
            ).toISOString();
        }
    } else if (
        serializedMedia.provider === MediaProviderEnum.CLOUDINARY &&
        serializedMedia.publicId &&
        isCloudinaryAuthenticated(serializedMedia)
    ) {
        // Ảnh riêng tư: ký URL mỗi lần trả về (không lưu url sẵn trong DB).
        serializedMedia.url = signCloudinaryAuthenticatedUrl(
            serializedMedia.publicId,
        );
        // Chỉ khi bật auth_token (trả phí) URL mới có TTL thật → mới gắn expiresAt
        // để client tự làm mới. Free tier ký chặn đoán link nhưng KHÔNG hết hạn.
        if (isAuthTokenEnabled()) {
            serializedMedia.expiresAt = new Date(
                Date.now() + MEDIA_CONSTANTS.SIGNED_URL_TTL_SECONDS * 1000,
            ).toISOString();
        }
    }

    return serializedMedia as MediaResponse;
};
