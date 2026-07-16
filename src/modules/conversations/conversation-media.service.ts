import {
    BadRequestException,
    Inject,
    Injectable,
    forwardRef,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import {
    CleanupJobEntityEnum,
    CleanupJobResourceEnum,
} from '../cleanup-jobs/types/cleanup-job';
import {
    MEDIA_CONSTANTS,
    MEDIA_MESSAGES,
} from '../media/constants/media.constant';
import { Media } from '../media/schemas/media.schema';
import { MediaProviderEnum, OwnerTypeEnum } from '../media/types/media';
import { MediaService } from '../media/media.service';
import { CONVERSATION_MESSAGES } from './constants/conversation.constant';
import { ConversationAccessService } from './conversation-access.service';
import { ConversationSerializerService } from './conversation-serializer.service';
import {
    Conversation,
    ConversationDocument,
} from './schemas/conversation.schema';

@Injectable()
export class ConversationMediaService {
    constructor(
        @InjectModel(Conversation.name)
        private readonly conversationModel: Model<ConversationDocument>,

        @InjectConnection()
        private readonly connection: Connection,

        @Inject(forwardRef(() => MediaService))
        private readonly mediaService: MediaService,

        private readonly conversationAccessService: ConversationAccessService,

        private readonly conversationSerializerService: ConversationSerializerService,
    ) {}

    /**
     * Upload avatar group chat, cập nhật media record và rollback file nếu update thất bại.
     */
    async uploadAvatar(
        conversationId: string,
        userId: string,
        file: Express.Multer.File,
    ) {
        const { conversation, objectConversationId } =
            await this.conversationAccessService.getConversationOrThrow(
                conversationId,
            );
        this.conversationAccessService.ensureGroupConversation(conversation);
        const objectUserId = this.conversationAccessService.ensureGroupAdmin(
            conversation,
            userId,
        );
        let uploadedAvatar: Media | null = null;
        let isUpdatedUser = false;
        const session = await this.connection.startSession();
        try {
            uploadedAvatar = await this.mediaService.uploadImageToCloudinary(
                objectUserId,
                OwnerTypeEnum.CONVERSATION,
                objectConversationId,
                file,
                MEDIA_CONSTANTS.CONVERSATION_AVATAR_FOLDER,
            );
            if (!uploadedAvatar) {
                throw new BadRequestException(
                    MEDIA_MESSAGES.FILE_UPLOAD_FAILED,
                );
            }
            const avatarOld = conversation.avatar
                ? await this.mediaService.findById(
                      conversation.avatar?.toString(),
                  )
                : null;

            const conversationUpdated = await session.withTransaction(
                async () => {
                    const createdMedia = await this.mediaService.createMedia(
                        uploadedAvatar as Media,
                        session,
                    );
                    const updated = await this.conversationModel
                        .findByIdAndUpdate(
                            objectConversationId,
                            {
                                $set: {
                                    avatar: createdMedia._id,
                                },
                            },
                            { returnDocument: 'after', session },
                        )
                        .select('-__v')
                        .populate({
                            path: 'users',
                            select: '-password -email -phone -__v',
                            populate: { path: 'avatar', select: '-__v' },
                        })
                        .populate('lastMessageId', '-__v')
                        .populate('avatar', '-__v')
                        .lean();
                    if (!updated) {
                        throw new BadRequestException(
                            CONVERSATION_MESSAGES.AVATAR_UPLOAD_FAILED,
                        );
                    }
                    if (avatarOld) {
                        await this.mediaService.deleteMedia(
                            avatarOld._id.toString(),
                            session,
                        );
                    }
                    return updated;
                },
            );
            if (avatarOld && avatarOld.publicId) {
                await this.mediaService
                    .deleteImageFromCloudinaryWithCleanup(avatarOld.publicId, {
                        entityType: CleanupJobEntityEnum.CONVERSATION,
                        entityId: conversation._id.toString(),
                        resourceType:
                            CleanupJobResourceEnum.CONVERSATION_AVATAR,
                    })
                    .catch((cleanupError) => {
                        console.error(
                            'Failed to cleanup uploaded avatar:',
                            cleanupError,
                        );
                    });
            }

            isUpdatedUser = true;
            return await this.conversationSerializerService.serializeConversation(
                conversationUpdated,
                userId,
                [],
                true,
            );
        } catch (error) {
            if (uploadedAvatar && uploadedAvatar.publicId && !isUpdatedUser) {
                await this.mediaService.deleteImageFromCloudinaryWithCleanup(
                    uploadedAvatar.publicId,
                    {
                        entityType: CleanupJobEntityEnum.CONVERSATION,
                        entityId: conversation._id.toString(),
                        resourceType:
                            CleanupJobResourceEnum.CONVERSATION_AVATAR,
                    },
                );
            }
            throw error;
        } finally {
            await session.endSession();
        }
    }

    /**
     * Xóa avatar group chat và dọn media cũ tương ứng.
     */
    async deleteAvatar(conversationId: string, userId: string) {
        const { conversation, objectConversationId } =
            await this.conversationAccessService.getConversationOrThrow(
                conversationId,
            );
        this.conversationAccessService.ensureGroupConversation(conversation);
        this.conversationAccessService.ensureGroupAdmin(conversation, userId);
        if (!conversation.avatar) {
            throw new BadRequestException(
                CONVERSATION_MESSAGES.AVATAR_NOT_EXIST,
            );
        }
        const avatarOld = await this.mediaService.findById(
            conversation.avatar.toString(),
        );
        const session = await this.connection.startSession();
        try {
            const conversationUpdated = await session.withTransaction(
                async () => {
                    const update = await this.conversationModel
                        .findByIdAndUpdate(
                            objectConversationId,
                            {
                                $unset: {
                                    avatar: '',
                                },
                            },
                            { returnDocument: 'after', session },
                        )
                        .select('-__v')
                        .populate({
                            path: 'users',
                            select: '-password -email -phone -__v',
                            populate: { path: 'avatar', select: '-__v' },
                        })
                        .populate('lastMessageId', '-__v')
                        .populate('avatar', '-__v')
                        .lean();
                    if (!update) {
                        throw new BadRequestException(
                            CONVERSATION_MESSAGES.AVATAR_DELETE_FAILED,
                        );
                    }
                    if (avatarOld) {
                        await this.mediaService.deleteMedia(
                            avatarOld._id.toString(),
                            session,
                        );
                    }
                    return update;
                },
            );
            if (avatarOld?.publicId) {
                await this.mediaService.deleteImageFromCloudinaryWithCleanup(
                    avatarOld.publicId,
                    {
                        entityType: CleanupJobEntityEnum.CONVERSATION,
                        entityId: conversation._id.toString(),
                        resourceType:
                            CleanupJobResourceEnum.CONVERSATION_AVATAR,
                    },
                );
            }
            return await this.conversationSerializerService.serializeConversation(
                conversationUpdated,
                userId,
                [],
                true,
            );
        } finally {
            await session.endSession();
        }
    }
}
