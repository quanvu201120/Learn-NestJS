export enum MediaProviderEnum {
    CLOUDINARY = 'cloudinary',
    R2 = 'r2',
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
    createdAt?: Date | string;
    updatedAt?: Date | string;
};

export type ListMediaResponse = {
    nextCursor: string | null;
    medias: MediaResponse[];
};
