/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { MESSAGE_MESSAGES } from './constants/message.constant';
import {
    BadRequestException,
    forwardRef,
    Inject,
    Injectable,
    InternalServerErrorException,
} from '@nestjs/common';
import { UpdateMessageDto } from './dto/update-message.dto';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Message, MessageDocument } from './schemas/message.schema';
import { Connection, Model, Types, ClientSession } from 'mongoose';
import { parseDateOrThrow, toObjectId } from '@/utils/utils';
import { ConversationsService } from '../conversations/conversations.service';
import { GLOBAL_CONSTANTS } from '@/common/constants/global.constant';
import { serializeMessage } from './utils/message.serializer';
import { Subject } from 'rxjs';
import { UserResponse } from '../users/types/user';
import {
    MessageEnumType,
    MessageReactionEnumType,
    MessageResponse,
} from './types/message';
import {
    MediaProviderEnum,
    MediaResourceTypeEnum,
    OwnerTypeEnum,
} from '../media/types/media';
import { Media, MediaDocument } from '../media/schemas/media.schema';
import { MediaService } from '../media/media.service';
import {
    MEDIA_CONSTANTS,
    MEDIA_MESSAGES,
} from '../media/constants/media.constant';
import { RedisService } from '@/redis/redis.service';
import {
    CleanupJobEntityEnum,
    CleanupJobResourceEnum,
} from '../cleanup-jobs/types/cleanup-job';

@Injectable()
export class MessagesService {
    public readonly restoredConversation$ = new Subject<{
        conversationId: string;
        members: string[];
    }>();
    public readonly unseenMessage$ = new Subject<{
        conversationId: string;
        userIds: string[];
    }>();

    public readonly updatedMessage$ = new Subject<MessageResponse>();
    public readonly createdMessage$ = new Subject<MessageResponse>();

    constructor(
        @InjectModel(Message.name)
        private readonly messageModel: Model<MessageDocument>,
        @Inject(forwardRef(() => ConversationsService))
        private readonly conversationService: ConversationsService,
        @InjectConnection()
        private readonly connection: Connection,
        private readonly mediaService: MediaService,
        private readonly redisService: RedisService,
    ) {}

    /**
     * Lấy chi tiết một tin nhắn theo ID, kèm theo thông tin người gửi và tin nhắn được reply.
     */
    async getMessageById(messageId: string) {
        const objectMessageId = toObjectId(messageId, 'message id');
        const message = await this.messageModel
            .findById(objectMessageId)
            .populate({ path: 'senderId', select: '-password -__v', populate: { path: 'avatar', select: '-__v' } })
            .populate('replyTo', '-__v')
            .populate('mediaId', '-__v')
            .lean();

        if (!message) {
            throw new BadRequestException(MESSAGE_MESSAGES.MESSAGE_NOT_FOUND);
        }

        return serializeMessage(message);
    }

    /**
     * Kiểm tra xem một tin nhắn có tồn tại và thuộc về một cuộc trò chuyện cụ thể hay không.
     */
    async checkMessageExistInConversation(
        messageId: string,
        conversationId: string,
    ) {
        const objectMessageId = toObjectId(messageId, 'message id');
        const objectConversationId = toObjectId(
            conversationId,
            'conversation id',
        );
        const result = await this.messageModel.findOne({
            _id: objectMessageId,
            conversationId: objectConversationId,
        });
        if (!result) {
            throw new BadRequestException(MESSAGE_MESSAGES.MESSAGE_NOT_FOUND);
        }
        return result;
    }

    /**
     * Tạo một tin nhắn mới trong conversation và commit toàn bộ thay đổi theo transaction.
     * Sau khi lưu message thành công, hàm cập nhật `lastMessageId`, mở lại conversation
     * cho các thành viên đang bị ẩn (`hiddenHistory.isHidden = true`), rồi phát sự kiện
     * realtime để những client đó refresh sidebar khi tin nhắn đầu tiên xuất hiện.
     */
    async createMessage(
        senderId: string,
        conversationId: string,
        type: MessageEnumType,
        content?: string,
        replyTo?: string,
        file?: Express.Multer.File,
    ) {
        if (
            [MessageEnumType.TEXT, MessageEnumType.SYSTEM].includes(type) &&
            !content?.trim()
        ) {
            throw new BadRequestException(
                MESSAGE_MESSAGES.MESSAGE_CONTENT_REQUIRED,
            );
        }
        const { conversation, objectConversationId } =
            await this.conversationService.getConversationOrThrow(
                conversationId,
            );
        let objectSenderId: Types.ObjectId;
        if (type === MessageEnumType.SYSTEM) {
            objectSenderId = toObjectId(senderId, 'sender id');
        } else {
            objectSenderId =
                this.conversationService.ensureMemberInConversation(
                    conversation,
                    senderId,
                );
        }
        let objectReplyTo: Types.ObjectId | undefined;
        if (replyTo) {
            const replyMessage = await this.checkMessageExistInConversation(
                replyTo,
                conversationId,
            );
            if (!replyMessage) {
                throw new BadRequestException(MESSAGE_MESSAGES.REPLY_NOT_FOUND);
            }
            if (replyMessage.isDeleted) {
                throw new BadRequestException(MESSAGE_MESSAGES.REPLY_DELETED);
            }
            objectReplyTo = replyMessage._id;
        }
        let uploadedFile: Media | null = null;
        const provider: MediaProviderEnum =
            type === MessageEnumType.IMAGE
                ? MediaProviderEnum.CLOUDINARY
                : MediaProviderEnum.R2;
        const session = await this.connection.startSession();
        try {
            let newMessage: MessageDocument | null = null;

            if (
                type === MessageEnumType.IMAGE ||
                type === MessageEnumType.VIDEO ||
                type === MessageEnumType.FILE ||
                type === MessageEnumType.VOICE
            ) {
                if (!file) {
                    throw new BadRequestException(
                        MESSAGE_MESSAGES.FILE_REQUIRED,
                    );
                }

                if (provider === MediaProviderEnum.CLOUDINARY) {
                    uploadedFile =
                        await this.mediaService.uploadImageToCloudinary(
                            objectSenderId,
                            OwnerTypeEnum.CONVERSATION,
                            objectConversationId,
                            file,
                            MEDIA_CONSTANTS.CONVERSATION_IMAGE_FOLDER,
                        );
                    if (!uploadedFile) {
                        throw new BadRequestException(
                            MEDIA_MESSAGES.FILE_UPLOAD_FAILED,
                        );
                    }
                } else {
                    const resourceType: MediaResourceTypeEnum =
                        type === MessageEnumType.VIDEO
                            ? MediaResourceTypeEnum.VIDEO
                            : type === MessageEnumType.VOICE
                              ? MediaResourceTypeEnum.AUDIO
                              : MediaResourceTypeEnum.FILE;
                    const folder =
                        type === MessageEnumType.VIDEO
                            ? MEDIA_CONSTANTS.CONVERSATION_VIDEO_FOLDER
                            : type === MessageEnumType.VOICE
                              ? MEDIA_CONSTANTS.CONVERSATION_AUDIO_FOLDER
                              : MEDIA_CONSTANTS.CONVERSATION_FILE_FOLDER;
                    uploadedFile = await this.mediaService.uploadFileToR2(
                        objectSenderId,
                        OwnerTypeEnum.CONVERSATION,
                        objectConversationId,
                        file,
                        resourceType,
                        folder,
                    );
                    if (!uploadedFile) {
                        throw new BadRequestException(
                            MEDIA_MESSAGES.FILE_UPLOAD_FAILED,
                        );
                    }
                }
            }
            // bọc các lệnh ghi DB vào transaction thật
            await session.withTransaction(async () => {
                let createMedia: MediaDocument | null = null;
                // nếu có file được upload, tạo media
                if (uploadedFile) {
                    createMedia = await this.mediaService.createMedia(
                        uploadedFile,
                        session,
                    );
                }
                // tạo message
                const createdMessages = await this.messageModel.create(
                    [
                        {
                            conversationId: objectConversationId,
                            senderId: objectSenderId,
                            type,
                            content,
                            replyTo: objectReplyTo,
                            mediaId: createMedia?._id || undefined,
                        },
                    ],
                    { session }, // truyền session vào create để query này thuộc transaction
                );

                newMessage = createdMessages[0]; // create với session trả về mảng, lấy phần tử đầu
                // cập nhật lastMessageId và mở lại conversation cho các thành viên bị ẩn
                await this.conversationService.updateLastMessageAndRestoreConversation(
                    conversationId,
                    newMessage._id.toString(),
                    senderId,
                    session, // truyền session xuống service conversation để update cùng transaction
                );
            });
            if (!newMessage) {
                throw new InternalServerErrorException(
                    MESSAGE_MESSAGES.MESSAGE_NOT_CREATED,
                );
            }
            const userHiddenHistory = conversation.hiddenHistory
                ?.filter((user) => user.isHidden)
                ?.map((user) => user.userId.toString());

            if (userHiddenHistory && userHiddenHistory.length > 0) {
                this.restoredConversation$.next({
                    conversationId: conversation._id.toString(),
                    members: userHiddenHistory,
                });
            }
            await this.emitUnseenMessageForOnlineMembers(
                conversation.users,
                senderId,
                conversationId,
            );

            const newMessageId = (newMessage as MessageDocument)._id.toString();
            const message = await this.getMessageById(newMessageId);
            this.createdMessage$.next(message);
            return { message, conversation };
        } catch (error) {
            // nếu có lỗi xảy ra, rollback transaction và cleanup file đã upload
            if (
                uploadedFile &&
                uploadedFile.publicId &&
                uploadedFile.provider === MediaProviderEnum.CLOUDINARY
            ) {
                await this.mediaService.deleteImageFromCloudinaryWithCleanup(
                    uploadedFile.publicId,
                    {
                        entityType: CleanupJobEntityEnum.MESSAGE,
                        resourceType: CleanupJobResourceEnum.MESSAGE_MEDIA,
                    },
                );
            }
            if (
                uploadedFile &&
                uploadedFile.objectKey &&
                uploadedFile.provider === MediaProviderEnum.R2
            ) {
                await this.mediaService.deleteFileFromR2WithCleanup(
                    uploadedFile.objectKey,
                    {
                        entityType: CleanupJobEntityEnum.MESSAGE,
                        resourceType: CleanupJobResourceEnum.MESSAGE_MEDIA,
                    },
                );
            }
            throw error;
        } finally {
            await session.endSession();
        }
    }

    /**
     * Lấy tin nhắn mới nhất của một cuộc trò chuyện dựa trên lastMessageId.
     */
    async getLatestMessageOfConversation(conversationId: string) {
        const { conversation, objectConversationId } =
            await this.conversationService.getConversationOrThrow(
                conversationId,
            );

        if (!conversation.lastMessageId) {
            throw new BadRequestException(
                MESSAGE_MESSAGES.CONVERSATION_NO_MESSAGES,
            );
        }
        const lastMessage = await this.messageModel
            .findById(conversation.lastMessageId)
            .populate({ path: 'senderId', select: '-password -__v', populate: { path: 'avatar', select: '-__v' } })
            .populate('replyTo', '-__v')
            .populate('mediaId', '-__v')
            .lean();
        if (!lastMessage) {
            throw new BadRequestException(MESSAGE_MESSAGES.MESSAGE_NOT_FOUND);
        }
        return serializeMessage(lastMessage);
    }

    /**
     * Lấy danh sách tin nhắn của phòng chat (có phân trang bằng cursor).
     * Bỏ qua các tin nhắn cũ nếu người dùng đã từng Ẩn phòng chat (hiddenHistory).
     */
    async getMessagesByConversation(
        conversationId: string,
        userId: string,
        cursor?: string,
    ) {
        const { conversation, objectConversationId } =
            await this.conversationService.getConversationOrThrow(
                conversationId,
            );
        this.conversationService.ensureMemberInConversation(
            conversation,
            userId,
        );
        const userHidden = conversation.hiddenHistory.find(
            (item) => item.userId.toString() === userId,
        );

        const createdAtFilter: Record<string, Date> = {};
        if (cursor) {
            createdAtFilter.$lt = parseDateOrThrow(cursor, 'cursor');
        }
        if (userHidden?.hiddenAt) {
            createdAtFilter.$gte = userHidden.hiddenAt;
        }

        const result = await this.messageModel
            .find({
                conversationId: objectConversationId,
                ...(Object.keys(createdAtFilter).length > 0
                    ? { createdAt: createdAtFilter }
                    : {}),
            })
            .select('-__v')
            .populate({ path: 'senderId', select: '-password -__v', populate: { path: 'avatar', select: '-__v' } })
            .populate('replyTo', '-__v')
            .populate('mediaId', '-__v')
            .sort({ createdAt: -1 })
            .limit(GLOBAL_CONSTANTS.LIMIT_MESSAGES_DEFAULT)
            .lean();
        return result.map((message) => serializeMessage(message));
    }

    /**
     * Thu hồi (xóa mềm) tin nhắn của người gửi.
     */
    async softDeleteMessage(
        messageId: string,
        conversationId: string,
        userId: string,
    ) {
        const { conversation, objectConversationId } =
            await this.conversationService.getConversationOrThrow(
                conversationId,
            );
        this.conversationService.ensureMemberInConversation(
            conversation,
            userId,
        );
        const userHidden = conversation.hiddenHistory.find(
            (item) => item.userId.toString() === userId && item.isHidden,
        );
        if (userHidden) {
            throw new BadRequestException(
                MESSAGE_MESSAGES.CANNOT_DELETE_USER_HIDDEN,
            );
        }
        const checkMessage = await this.checkMessageExistInConversation(
            messageId,
            conversationId,
        );
        if (!checkMessage) {
            throw new BadRequestException(
                MESSAGE_MESSAGES.NOT_BELONG_TO_CONVERSATION,
            );
        }
        if (checkMessage.senderId.toString() !== userId) {
            throw new BadRequestException(MESSAGE_MESSAGES.NOT_MESSAGE_OWNER);
        }
        if (checkMessage.isDeleted) {
            throw new BadRequestException(MESSAGE_MESSAGES.ALREADY_DELETED);
        }
        const objectMessageId = toObjectId(messageId, 'message id');
        await this.messageModel
            .findOneAndUpdate(
                {
                    _id: objectMessageId,
                    conversationId: objectConversationId,
                },
                {
                    isDeleted: true,
                    deletedAt: new Date(),
                },
                { new: true },
            )
            .lean();
        return MESSAGE_MESSAGES.DELETE_SUCCESS;
    }

    /**
     * Xóa vĩnh viễn toàn bộ tin nhắn của một cuộc trò chuyện.
     * Được gọi khi giải tán nhóm.
     */
    async deleteMessagesByConversationId(
        conversationId: string,
        session?: ClientSession,
    ) {
        const objectConversationId = toObjectId(
            conversationId,
            'conversation id',
        );
        await this.messageModel.deleteMany(
            {
                conversationId: objectConversationId,
            },
            { session },
        );
    }

    /**
     * Cập nhật nội dung tin nhắn
     */
    async updateMessageContent(
        userId: string,
        messageId: string,
        content: string,
        conversationId: string,
    ) {
        const objectUserId = toObjectId(userId, 'user id');
        const objectMessageId = toObjectId(messageId, 'message id');
        const { conversation, objectConversationId } =
            await this.conversationService.getConversationOrThrow(
                conversationId,
            );
        this.conversationService.ensureMemberInConversation(
            conversation,
            userId,
        );
        const message = await this.messageModel
            .findOne({
                _id: objectMessageId,
                conversationId: objectConversationId,
                senderId: objectUserId,
                isDeleted: false,
                type: MessageEnumType.TEXT,
            })
            .populate({ path: 'senderId', select: '-password -__v', populate: { path: 'avatar', select: '-__v' } })
            .populate('replyTo', '-__v')
            .populate('mediaId', '-__v')
            .lean();

        if (!message) {
            throw new BadRequestException(MESSAGE_MESSAGES.MESSAGE_NOT_FOUND);
        }
        const serializedMessage = serializeMessage(message);

        if (serializedMessage.content === content) {
            return serializedMessage;
        }
        const updatedMessage = await this.messageModel
            .findOneAndUpdate(
                {
                    _id: objectMessageId,
                    conversationId: objectConversationId,
                    senderId: objectUserId,
                    isDeleted: false,
                    type: MessageEnumType.TEXT,
                },
                {
                    $set: { content },
                },
                { new: true },
            )
            .populate({ path: 'senderId', select: '-password -__v', populate: { path: 'avatar', select: '-__v' } })
            .populate('replyTo', '-__v')
            .populate('mediaId', '-__v')
            .lean();
        if (!updatedMessage) {
            throw new BadRequestException(MESSAGE_MESSAGES.MESSAGE_NOT_UPDATED);
        }
        const res = serializeMessage(updatedMessage);
        this.updatedMessage$.next(res);
        return res;
    }

    /**
     * Đánh dấu conversation là chưa đọc cho các thành viên đang online
     * và phát sự kiện realtime tới những user vừa được thêm cờ unseen.
     */
    private async emitUnseenMessageForOnlineMembers(
        members: Types.ObjectId[],
        senderId: string,
        conversationId: string,
    ) {
        const membersOnline = (
            await this.redisService.getUserOnlineInListIds(members)
        ).filter((item) => item.toString() !== senderId);

        if (membersOnline.length === 0) {
            return;
        }

        const resultUnseen = await this.redisService.setUnseenMessage(
            membersOnline,
            conversationId,
        );

        const userIdsNeedNotify =
            resultUnseen
                ?.map(([pipelineError, result], index) =>
                    !pipelineError && Number(result) > 0
                        ? membersOnline[index]?.toString()
                        : null,
                )
                .filter((userId): userId is string => !!userId) ?? [];

        if (userIdsNeedNotify.length > 0) {
            this.unseenMessage$.next({
                conversationId,
                userIds: userIdsNeedNotify,
            });
        }
    }

    async updateOrInsertReaction(
        userId: string,
        messageId: string,
        conversationId: string,
        type: MessageReactionEnumType,
    ) {
        const { conversation } =
            await this.conversationService.getConversationOrThrow(
                conversationId,
            );

        const objectUserId =
            this.conversationService.ensureMemberInConversation(
                conversation,
                userId,
            );

        const message = await this.checkMessageExistInConversation(
            messageId,
            conversationId,
        );

        if (message.isDeleted) {
            throw new BadRequestException(MESSAGE_MESSAGES.ALREADY_DELETED);
        }

        const hasReacted = message.reactions?.some((reaction) =>
            reaction.user.equals(objectUserId),
        );
        const updatedMessage = !hasReacted
            ? await this.messageModel
                  .findOneAndUpdate(
                      { _id: message._id },
                      {
                          $push: { reactions: { user: objectUserId, type } },
                      },
                      { new: true, runValidators: true },
                  )
                  .populate({ path: 'senderId', select: '-password -__v', populate: { path: 'avatar', select: '-__v' } })
                  .populate('replyTo', '-__v')
                  .populate('mediaId', '-__v')
                  .lean()
            : await this.messageModel
                  .findOneAndUpdate(
                      { _id: message._id },
                      {
                          $set: { 'reactions.$[elem].type': type },
                      },
                      {
                          arrayFilters: [{ 'elem.user': objectUserId }],
                          new: true,
                          runValidators: true,
                      },
                  )
                  .populate({ path: 'senderId', select: '-password -__v', populate: { path: 'avatar', select: '-__v' } })
                  .populate('replyTo', '-__v')
                  .populate('mediaId', '-__v')
                  .lean();
        if (!updatedMessage) {
            throw new BadRequestException(MESSAGE_MESSAGES.MESSAGE_NOT_UPDATED);
        }
        const res = serializeMessage(updatedMessage);
        this.updatedMessage$.next(res);
        return res;
    }

    async removeReaction(
        userId: string,
        messageId: string,
        conversationId: string,
    ) {
        const { conversation } =
            await this.conversationService.getConversationOrThrow(
                conversationId,
            );

        const objectUserId =
            this.conversationService.ensureMemberInConversation(
                conversation,
                userId,
            );

        const message = await this.checkMessageExistInConversation(
            messageId,
            conversationId,
        );

        if (message.isDeleted) {
            throw new BadRequestException(MESSAGE_MESSAGES.ALREADY_DELETED);
        }

        const updatedMessage = await this.messageModel
            .findOneAndUpdate(
                { _id: message._id },
                {
                    $pull: { reactions: { user: objectUserId } },
                },
                { new: true, runValidators: true },
            )
            .populate({ path: 'senderId', select: '-password -__v', populate: { path: 'avatar', select: '-__v' } })
            .populate('replyTo', '-__v')
            .populate('mediaId', '-__v')
            .lean();

        if (!updatedMessage) {
            throw new BadRequestException(MESSAGE_MESSAGES.MESSAGE_NOT_UPDATED);
        }

        const res = serializeMessage(updatedMessage);
        this.updatedMessage$.next(res);
        return res;
    }
}
