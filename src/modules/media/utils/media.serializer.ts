/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Types } from 'mongoose';
import { MediaProviderEnum } from '../types/media';

/**
 * Lấy base URL public của R2 và bỏ dấu `/` cuối chuỗi
 * để có thể nối với `objectKey` an toàn.
 */
const getR2PublicBaseUrl = () => {
    return process.env.R2_PUBLIC_BASE_URL?.replace(/\/$/, '') || '';
};

/**
 * Chuyển `objectKey` của file lưu trên R2 thành URL public để trả về cho client.
 */
export const buildR2MediaUrl = (objectKey: string) => {
    if (!objectKey) {
        return undefined;
    }

    const publicBaseUrl = getR2PublicBaseUrl();

    return publicBaseUrl ? `${publicBaseUrl}/${objectKey}` : undefined;
};

/**
 * Chuẩn hóa field media trước khi trả về API.
 * Hỗ trợ cả document đã populate, ObjectId hoặc string id thô.
 */
export const serializeMedia = (media: any) => {
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
    }

    return serializedMedia;
};
