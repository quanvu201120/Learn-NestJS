/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { CloudinaryService } from './providers/cloudinary.service';
import { R2Service } from './providers/r2.service';
import { Media, MediaDocument } from './schemas/media.schema';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { MEDIA_MESSAGES } from './constants/media.constant';
import {
    MediaProviderEnum,
    MediaResourceTypeEnum,
    OwnerTypeEnum,
} from './types/media';
import { toObjectId } from '@/utils/utils';

@Injectable()
export class MediaService implements OnModuleInit {
    constructor(
        @InjectModel(Media.name) private mediaModel: Model<MediaDocument>,
        private readonly cloudinaryService: CloudinaryService,
        private readonly r2Service: R2Service,
    ) {}

    async onModuleInit() {
        // console.log(
        //     'Cloudinary initialized',
        //     await this.cloudinaryService.ping(),
        // );
    }

    /**
     * Lưu một bản ghi media vào MongoDB và hỗ trợ gắn vào transaction có sẵn nếu cần.
     */
    async createMedia(media: Media, session?: ClientSession) {
        const result = await this.mediaModel.create([media], { session });
        const createdMedia = result[0];
        if (!createdMedia) {
            throw new BadRequestException(MEDIA_MESSAGES.MEDIA_CREATE_FAILED);
        }
        return createdMedia;
    }

    /**
     * Tìm document media theo id.
     */
    async findById(id: string, session?: ClientSession) {
        const objectId = toObjectId(id, 'media id');
        return await this.mediaModel.findById(objectId, null, {
            session,
        });
    }

    /**
     * Lấy các khóa định danh storage cần thiết để cleanup media của một conversation.
     */
    async getKeysMediaByConversation(
        conversationId: string,
        session?: ClientSession,
    ) {
        const objectConversationId = toObjectId(
            conversationId,
            'conversation id',
        );
        return await this.mediaModel
            .find(
                {
                    ownerType: OwnerTypeEnum.CONVERSATION,
                    ownerId: objectConversationId,
                },
                null,
                {
                    session,
                },
            )
            .select('_id publicId objectKey provider')
            .lean();
    }

    /**
     * Xóa toàn bộ bản ghi media thuộc về một conversation khỏi MongoDB.
     */
    async deleteAllMediaByConversation(
        conversationId: string,
        session?: ClientSession,
    ) {
        const objectConversationId = toObjectId(
            conversationId,
            'conversation id',
        );
        return await this.mediaModel.deleteMany(
            {
                ownerType: OwnerTypeEnum.CONVERSATION,
                ownerId: objectConversationId,
            },
            {
                session,
            },
        );
    }

    /**
     * Xóa một bản ghi media khỏi MongoDB.
     */
    async deleteMedia(id: string, session?: ClientSession) {
        const objectId = toObjectId(id, 'media id');
        const result = await this.mediaModel.findByIdAndDelete(objectId, {
            session,
        });
        return !!result;
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
        return await this.cloudinaryService.uploadImage(
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
        return await this.cloudinaryService.deleteResource(publicId);
    }

    /**
     * Xóa nhiều ảnh trên Cloudinary theo dạng batch.
     */
    async deleteImagesFromCloudinary(publicIds: string[]) {
        return await this.cloudinaryService.deleteResources(publicIds);
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

    /**
     * Tách media của conversation thành danh sách `publicId` của Cloudinary
     * và `objectKey` của R2 để cleanup sau khi transaction commit thành công.
     */
    async getMediaCleanupKeysByConversation(
        conversationId: string,
        session?: ClientSession,
    ) {
        toObjectId(conversationId, 'conversation id');
        const mediaList = await this.getKeysMediaByConversation(
            conversationId,
            session,
        );
        if (!mediaList.length) {
            return { listPublicId: [], listObjectKey: [] };
        }
        const { listPublicId, listObjectKey } = mediaList.reduce(
            (acc, media) => {
                if (
                    media.provider === MediaProviderEnum.CLOUDINARY &&
                    media.publicId
                ) {
                    acc.listPublicId.push(media.publicId);
                }

                if (
                    media.provider === MediaProviderEnum.R2 &&
                    media.objectKey
                ) {
                    acc.listObjectKey.push(media.objectKey);
                }

                return acc;
            },
            {
                listPublicId: [] as string[],
                listObjectKey: [] as string[],
            },
        );
        return { listPublicId, listObjectKey };
    }
}
