/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable prefer-const */

/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
    BadRequestException,
    ForbiddenException,
    forwardRef,
    Inject,
    Injectable,
    NotFoundException,
    OnModuleInit,
} from '@nestjs/common';
import { CloudinaryService } from './providers/cloudinary.service';
import { R2Service } from './providers/r2.service';
import { Media, MediaDocument } from './schemas/media.schema';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { MEDIA_MESSAGES } from './constants/media.constant';
import {
    ListMediaResponse,
    MediaProviderEnum,
    MediaResourceTypeEnum,
    MediaResponse,
    OwnerTypeEnum,
} from './types/media';
import { parseDateOrThrow, toObjectId } from '@/utils/utils';
import { CleanupJobsService } from '../cleanup-jobs/cleanup-jobs.service';
import { CreateCleanupJobDto } from '../cleanup-jobs/dto/create-cleanup-job.dto';
import {
    CleanupJobActionEnum,
    CleanupJobEntityEnum,
    CleanupJobResourceEnum,
} from '../cleanup-jobs/types/cleanup-job';
import {
    Conversation,
    ConversationDocument,
} from '../conversations/schemas/conversation.schema';
import { CONVERSATION_MESSAGES } from '../conversations/constants/conversation.constant';
import { GLOBAL_CONSTANTS } from '@/common/constants/global.constant';
import { serializeMedia } from './utils/media.serializer';
import { RelationshipsService } from '../relationships/relationships.service';

type MediaCleanupContext = {
    resourceType: CleanupJobResourceEnum;
    entityType: CleanupJobEntityEnum;
    entityId?: string;
};

@Injectable()
export class MediaService implements OnModuleInit {
    constructor(
        @InjectModel(Media.name) private mediaModel: Model<MediaDocument>,
        @InjectModel(Conversation.name)
        private conversationModel: Model<ConversationDocument>,
        private readonly cloudinaryService: CloudinaryService,
        private readonly r2Service: R2Service,
        @Inject(forwardRef(() => CleanupJobsService))
        private readonly cleanupJobsService: CleanupJobsService,
        @Inject(forwardRef(() => RelationshipsService))
        private readonly relationshipsService: RelationshipsService,
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

    async getMediasByConversation(
        conversationId: string,
        userId: string,
        type: MediaResourceTypeEnum, // Đã thêm type để filter
        cursor?: string,
        session?: ClientSession,
    ) {
        const objectConversationId = toObjectId(
            conversationId,
            'conversation id',
        );
        const objectUserId = toObjectId(userId, 'user id');

        let query = this.conversationModel
            .findOne({
                _id: objectConversationId,
                users: objectUserId,
            })
            .select('_id hiddenHistory users');

        if (session) {
            query.session(session);
        }
        const conversation = await query.lean();

        if (!conversation) {
            throw new NotFoundException(
                CONVERSATION_MESSAGES.CONVERSATION_NOT_FOUND,
            );
        }

        // Dùng optional chaining (?.) để tránh crash nếu DB cũ không có mảng này
        const userHidden = conversation.hiddenHistory?.find(
            (item) => item?.userId?.toString() === objectUserId.toString(),
        );

        const createdAtFilter: Record<string, Date> = {};
        if (cursor) {
            createdAtFilter.$lt = parseDateOrThrow(cursor, 'cursor');
        }
        if (userHidden?.hiddenAt) {
            createdAtFilter.$gte = userHidden.hiddenAt;
        }

        const blockedUserIds =
            await this.relationshipsService.getBlockedUserIdsAmongUsers(
                userId,
                Array.isArray(conversation.users)
                    ? conversation.users
                          .map((item: any) => item?.toString())
                          .filter((item): item is string => !!item)
                    : [],
            );

        let mediaQuery = this.mediaModel.find({
            ownerId: objectConversationId,
            ownerType: OwnerTypeEnum.CONVERSATION,
            resourceType: type, // Filter theo type
            isDeleted: { $ne: true }, // Không lấy media đã bị thu hồi
            ...(blockedUserIds.length > 0
                ? {
                      uploadedBy: {
                          $nin: blockedUserIds.map((blockedUserId) =>
                              toObjectId(blockedUserId, 'blocked user id'),
                          ),
                      },
                  }
                : {}),
            ...(Object.keys(createdAtFilter).length > 0
                ? { createdAt: createdAtFilter }
                : {}),
        });

        // Bổ sung session cho query này (bạn đang bị thiếu)
        if (session) {
            mediaQuery.session(session);
        }

        const medias = await mediaQuery
            .sort({ createdAt: -1, _id: -1 })
            .limit(GLOBAL_CONSTANTS.LIMIT_MEDIAS_DEFAULT)
            .lean();

        if (medias.length === 0) {
            return { nextCursor: null, medias: [] } as ListMediaResponse;
        }

        const formattedMedias: MediaResponse[] = medias.map((media) =>
            serializeMedia(media),
        );

        const hasNextPage =
            formattedMedias.length === GLOBAL_CONSTANTS.LIMIT_MEDIAS_DEFAULT;
        const lastMedia = formattedMedias[formattedMedias.length - 1];
        const nextCursor =
            hasNextPage && lastMedia?.createdAt
                ? new Date(lastMedia.createdAt).toISOString()
                : null;

        return { nextCursor, medias: formattedMedias } as ListMediaResponse;
    }

    /**
     * Download file media từ R2 theo id và kiểm tra quyền truy cập.
     */
    async downloadR2Media(id: string, userId: string) {
        const media = await this.findById(id);

        if (!media) {
            throw new NotFoundException(MEDIA_MESSAGES.MEDIA_NOT_FOUND);
        }

        await this.assertMediaAccess(media, userId);

        if (media.provider !== MediaProviderEnum.R2 || !media.objectKey) {
            throw new BadRequestException(
                MEDIA_MESSAGES.MEDIA_NOT_STORED_IN_R2,
            );
        }

        const result = await this.r2Service.getObject(media.objectKey);
        const bytes = await result.Body?.transformToByteArray();

        if (!bytes) {
            throw new NotFoundException(MEDIA_MESSAGES.MEDIA_CONTENT_NOT_FOUND);
        }

        return {
            buffer: Buffer.from(bytes),
            fileName: media.fileName || 'download',
            mimeType: media.mimeType || 'application/octet-stream',
        };
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
     * Xóa một ảnh trên Cloudinary theo `publicId` và tạo cleanup job nếu có lỗi.
     */
    async deleteImageFromCloudinaryWithCleanup(
        publicId: string,
        cleanup: MediaCleanupContext,
    ) {
        try {
            return await this.deleteImageFromCloudinary(publicId);
        } catch (error) {
            await this.createCleanupJob({
                resourceType: cleanup.resourceType,
                action: CleanupJobActionEnum.CLOUDINARY_DELETE_ONE,
                entityType: cleanup.entityType,
                entityId: cleanup.entityId,
                payload: {
                    publicId,
                },
                error: (error as Error)?.message,
            });
            return null;
        }
    }

    /**
     * Xóa nhiều ảnh trên Cloudinary theo dạng batch.
     */
    async deleteImagesFromCloudinary(publicIds: string[]) {
        return await this.cloudinaryService.deleteResources(publicIds);
    }

    /**
     * Xóa nhiều ảnh trên Cloudinary theo dạng batch và tạo cleanup job nếu có lỗi.
     */
    async deleteImagesFromCloudinaryWithCleanup(
        publicIds: string[],
        cleanup: MediaCleanupContext,
    ) {
        try {
            return await this.deleteImagesFromCloudinary(publicIds);
        } catch (error) {
            await this.createCleanupJob({
                resourceType: cleanup.resourceType,
                action: CleanupJobActionEnum.CLOUDINARY_DELETE_MANY,
                entityType: cleanup.entityType,
                entityId: cleanup.entityId,
                payload: {
                    publicIds,
                },
                error: (error as Error)?.message,
            });
            return null;
        }
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
     * Xóa một file trên R2 theo `objectKey` và tạo cleanup job nếu có lỗi.
     */
    async deleteFileFromR2WithCleanup(
        objectKey: string,
        cleanup: MediaCleanupContext,
    ) {
        try {
            return await this.deleteFileFromR2(objectKey);
        } catch (error) {
            await this.createCleanupJob({
                resourceType: cleanup.resourceType,
                action: CleanupJobActionEnum.R2_DELETE_ONE,
                entityType: cleanup.entityType,
                entityId: cleanup.entityId,
                payload: {
                    objectKey,
                },
                error: (error as Error)?.message,
            });
            return null;
        }
    }

    /**
     * Xóa nhiều file trên R2 theo danh sách `objectKey`.
     */
    async deleteFilesFromR2(objectKeys: string[]) {
        return await this.r2Service.deleteObjects(objectKeys);
    }

    /**
     * Xóa nhiều file trên R2 theo danh sách `objectKey` và tạo cleanup job nếu có lỗi.
     */
    async deleteFilesFromR2WithCleanup(
        objectKeys: string[],
        cleanup: MediaCleanupContext,
    ) {
        try {
            return await this.deleteFilesFromR2(objectKeys);
        } catch (error) {
            await this.createCleanupJob({
                resourceType: cleanup.resourceType,
                action: CleanupJobActionEnum.R2_DELETE_MANY,
                entityType: cleanup.entityType,
                entityId: cleanup.entityId,
                payload: {
                    objectKeys,
                },
                error: (error as Error)?.message,
            });
            return null;
        }
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

    private async createCleanupJob(createDto: CreateCleanupJobDto) {
        try {
            await this.cleanupJobsService.createCleanupJob(createDto);
        } catch (error) {
            console.error('Failed to create cleanup job: ', error);
        }
    }

    private async assertMediaAccess(media: MediaDocument, userId: string) {
        const objectUserId = toObjectId(userId, 'user id');

        if (media.ownerType === OwnerTypeEnum.USER) {
            const ownerId = media.ownerId?.toString();
            const uploadedBy = media.uploadedBy?.toString();
            if (
                ownerId !== objectUserId.toString() &&
                uploadedBy !== objectUserId.toString()
            ) {
                throw new ForbiddenException(
                    MEDIA_MESSAGES.MEDIA_ACCESS_DENIED,
                );
            }
            return;
        }

        if (media.ownerType === OwnerTypeEnum.CONVERSATION) {
            const hasAccess = await this.conversationModel.exists({
                _id: media.ownerId,
                users: objectUserId,
            });

            if (!hasAccess) {
                throw new ForbiddenException(
                    MEDIA_MESSAGES.MEDIA_ACCESS_DENIED,
                );
            }
        }
    }
}
