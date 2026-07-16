import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { toObjectId } from '@/utils/utils';
import { MEDIA_MESSAGES } from './constants/media.constant';
import { Media, MediaDocument } from './schemas/media.schema';
import { MediaProviderEnum, OwnerTypeEnum } from './types/media';

@Injectable()
export class MediaPersistenceService {
    constructor(
        @InjectModel(Media.name) private mediaModel: Model<MediaDocument>,
    ) {}

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

    /**
     * Xoá mềm media khi xoá tin nhắn.
     *  -> đảm bảo media đã bị xoá sẽ không được sử dụng lại.
     */
    async softDeleteMediaWithMessage(
        mediaId: string,
        conversationId: string,
        session?: ClientSession,
    ) {
        const objectMediaId = toObjectId(mediaId, 'media id');
        const objectConversationId = toObjectId(
            conversationId,
            'conversation id',
        );

        const media = await this.mediaModel
            .findOne(
                {
                    _id: objectMediaId,
                    isDeleted: { $ne: true },
                    ownerType: OwnerTypeEnum.CONVERSATION,
                    ownerId: objectConversationId,
                },
                null,
                { session },
            )
            .select('_id')
            .lean();

        if (!media) {
            throw new BadRequestException(MEDIA_MESSAGES.MEDIA_NOT_FOUND);
        }

        return await this.mediaModel
            .findOneAndUpdate(
                {
                    _id: objectMediaId,
                    isDeleted: { $ne: true },
                    ownerType: OwnerTypeEnum.CONVERSATION,
                    ownerId: objectConversationId,
                },
                { $set: { isDeleted: true, deletedAt: new Date() } },
                { returnDocument: 'after', session },
            )
            .select('_id')
            .lean();
    }
}
