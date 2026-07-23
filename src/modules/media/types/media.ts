export enum MediaProviderEnum {
    CLOUDINARY = 'cloudinary',
    R2 = 'r2',
}

/**
 * Kiểu phân phối của asset trên Cloudinary.
 * - UPLOAD: asset public (avatar) → URL dùng thẳng, không cần ký.
 * - AUTHENTICATED: asset riêng tư (ảnh chat, ảnh bằng chứng report) → phải ký URL
 *   mỗi lần trả về; khi bật `auth_token` sẽ có TTL thật.
 */
export enum CloudinaryDeliveryTypeEnum {
    UPLOAD = 'upload',
    AUTHENTICATED = 'authenticated',
}

export enum MediaResourceTypeEnum {
    IMAGE = 'image',
    VIDEO = 'video',
    AUDIO = 'audio',
    FILE = 'file',
}

export enum OwnerTypeEnum {
    USER = 'User',
    CONVERSATION = 'Conversation',
}

export enum ActionEnum {
    UPLOAD = 'upload',
    DELETE = 'delete',
}

export type MediaResponse = {
    _id: string;
    uploadedBy?: string;
    ownerType: OwnerTypeEnum;
    ownerId?: string;
    provider: MediaProviderEnum;
    resourceType: MediaResourceTypeEnum;
    publicId?: string;
    objectKey?: string;
    fileName?: string;
    mimeType?: string;
    size?: number;
    width?: number;
    height?: number;
    duration?: number;
    thumbUrl?: string;
    url?: string;
    deliveryType?: CloudinaryDeliveryTypeEnum;
    expiresAt?: string;
    createdAt?: Date | string;
    updatedAt?: Date | string;
};

export type ListMediaResponse = {
    nextCursor: string | null;
    medias: MediaResponse[];
};
