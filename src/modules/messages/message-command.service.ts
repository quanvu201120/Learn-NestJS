/* eslint-disable @typescript-eslint/no-floating-promises */
import {
    BadRequestException,
    forwardRef,
    Inject,
    Injectable,
    InternalServerErrorException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { AUTH_MESSAGES } from '@/auth/constants/auth.constant';
import { formatDateTime, toObjectId } from '@/utils/utils';
import { ConversationsService } from '../conversations/conversations.service';
import { Media, MediaDocument } from '../media/schemas/media.schema';
import { MediaProviderEnum } from '../media/types/media';
import { MediaService } from '../media/media.service';
import { RelationshipsService } from '../relationships/relationships.service';
import { StatsService } from '../stats/stats.service';
import { UsersService } from '../users/users.service';
import { MESSAGE_MESSAGES } from './constants/message.constant';
import { MessageEventService } from './message-event.service';
import { MessageLookupService } from './message-lookup.service';
import { MessageMediaService } from './message-media.service';
import { MessageRealtimeService } from './message-realtime.service';
import { Message, MessageDocument } from './schemas/message.schema';
import { MessageCreatedEvents, MessageEnumType } from './types/message';
import { serializeMessage } from './utils/message.serializer';

@Injectable()
export class MessageCommandService {
    constructor(
        @InjectModel(Message.name)
        private readonly messageModel: Model<MessageDocument>,
        @Inject(forwardRef(() => ConversationsService))
        private readonly conversationService: ConversationsService,
        @InjectConnection()
        private readonly connection: Connection,
        @Inject(forwardRef(() => MediaService))
        private readonly mediaService: MediaService,
        @Inject(forwardRef(() => UsersService))
        private readonly usersService: UsersService,
        @Inject(forwardRef(() => RelationshipsService))
        private readonly relationshipsService: RelationshipsService,
        private readonly statsService: StatsService,
        private readonly messageLookupService: MessageLookupService,
        private readonly messageMediaService: MessageMediaService,
        private readonly messageRealtimeService: MessageRealtimeService,
        private readonly messageEventService: MessageEventService,
    ) {}

    /**
     * Tạo một tin nhắn mới trong conversation và commit toàn bộ thay đổi theo transaction.
     * Sau khi lưu message thành công, hàm cập nhật `lastMessageId`, mở lại conversation
     * cho các thành viên đang bị ẩn (`hiddenHistory.isHidden = true`), rồi phát sự kiện
     * realtime để những client đó refresh sidebar khi tin nhắn đầu tiên xuất hiện.
     * nếu là create tự tạo session thì phát sự kiện socket ngay,
     * còn nếu là ở nơi khác gọi, có truyền session vào thì để nơi gọi phát socket sau khi commit transition hoàn tất
     */
    async createMessage(
        senderId: string,
        conversationId: string,
        type: MessageEnumType,
        content?: string,
        replyTo?: string,
        file?: Express.Multer.File,
        externalSession?: ClientSession,
    ) {
        if (
            [MessageEnumType.TEXT, MessageEnumType.SYSTEM].includes(type) &&
            !content?.trim()
        ) {
            throw new BadRequestException(
                MESSAGE_MESSAGES.MESSAGE_CONTENT_REQUIRED,
            );
        }

        if (type !== MessageEnumType.SYSTEM) {
            const sender = await this.usersService.findOne(senderId);
            if (sender?.muteUntil && sender.muteUntil > new Date()) {
                const time = formatDateTime(sender.muteUntil);
                throw new BadRequestException(
                    MESSAGE_MESSAGES.USER_MUTED(time),
                );
            }

            if (sender?.banUntil && sender?.banUntil > new Date()) {
                const time = formatDateTime(sender.banUntil);
                throw new BadRequestException(
                    AUTH_MESSAGES.ACCOUNT_BANNED_UNTIL(time),
                );
            }
        }

        const { conversation, objectConversationId } =
            await this.conversationService.getConversationOrThrow(
                conversationId,
            );

        if (!conversation.isGroup && type !== MessageEnumType.SYSTEM) {
            const targetId = conversation.users.find(
                (id) => !id.equals(toObjectId(senderId, 'sender id')),
            );
            if (targetId) {
                const isBlocked =
                    await this.relationshipsService.checkIsBlocked(
                        senderId,
                        targetId.toString(),
                    );
                if (isBlocked) {
                    throw new BadRequestException(
                        MESSAGE_MESSAGES.CANNOT_SEND_MESSAGE_TO_BLOCKED_USER,
                    );
                }
            }
        }

        await this.conversationService.ensureDirectChatActive(
            conversation,
            senderId,
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
            const replyMessage =
                await this.messageLookupService.checkMessageExistInConversation(
                    replyTo,
                    conversationId,
                );
            if (!replyMessage) {
                throw new BadRequestException(MESSAGE_MESSAGES.REPLY_NOT_FOUND);
            }
            if (replyMessage.isDeleted) {
                throw new BadRequestException(MESSAGE_MESSAGES.REPLY_DELETED);
            }
            if (replyMessage.callId) {
                throw new BadRequestException(
                    MESSAGE_MESSAGES.CALL_MESSAGE_ACTION_NOT_ALLOWED,
                );
            }
            if (replyMessage.senderId.toString() !== senderId) {
                const isBlocked =
                    await this.relationshipsService.checkIsBlocked(
                        senderId,
                        replyMessage.senderId.toString(),
                    );
                if (isBlocked) {
                    throw new BadRequestException(
                        MESSAGE_MESSAGES.CANNOT_REPLY_BLOCKED_USER,
                    );
                }
            }
            objectReplyTo = replyMessage._id;
        }
        let uploadedFile: Media | null = null;
        const isExternalSession = !!externalSession;
        const session =
            externalSession || (await this.connection.startSession());
        try {
            let newMessage: MessageDocument | null = null;

            uploadedFile = await this.messageMediaService.uploadMessageMedia(
                type,
                objectSenderId,
                objectConversationId,
                file,
            );

            //Định nghĩa hàm create message để sử dụng trong transaction
            const executeMessageCreation = async () => {
                let createMedia: MediaDocument | null = null;
                if (uploadedFile) {
                    createMedia = await this.mediaService.createMedia(
                        uploadedFile,
                        session,
                    );
                }
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
                    { session },
                );

                newMessage = createdMessages[0];
                await this.conversationService.updateLastMessageAndRestoreConversation(
                    conversationId,
                    newMessage._id.toString(),
                    senderId,
                    session,
                );
            };

            //Gọi hàm create message tùy thuộc vào việc có session bên ngoài truyền vào không
            if (isExternalSession) {
                await executeMessageCreation();
            } else {
                await session.withTransaction(executeMessageCreation);
            }

            if (!newMessage) {
                throw new InternalServerErrorException(
                    MESSAGE_MESSAGES.MESSAGE_NOT_CREATED,
                );
            }
            const events: MessageCreatedEvents = {};
            const userHiddenHistory = conversation.hiddenHistory
                ?.filter((user) => user.isHidden)
                ?.map((user) => user.userId.toString());

            if (userHiddenHistory && userHiddenHistory.length > 0) {
                events.restoredConversation = {
                    conversationId: conversation._id.toString(),
                    members: userHiddenHistory,
                };
            }
            const userIdsNeedNotify =
                await this.messageRealtimeService.getUnseenMessageUserIds(
                    conversation.users,
                    senderId,
                    conversationId,
                );
            if (userIdsNeedNotify.length > 0) {
                events.unseenMessage = {
                    conversationId,
                    userIds: userIdsNeedNotify,
                };
            }

            const newMessageId = (newMessage as MessageDocument)._id.toString();
            const message = await this.messageLookupService.getMessageById(
                newMessageId,
                session,
            );
            events.createdMessage = message;

            if (!isExternalSession) {
                if (events.restoredConversation) {
                    this.messageEventService.restoredConversation$.next(
                        events.restoredConversation,
                    );
                }
                if (events.unseenMessage) {
                    this.messageEventService.unseenMessage$.next(
                        events.unseenMessage,
                    );
                }
                if (events.createdMessage) {
                    this.messageEventService.createdMessage$.next(
                        events.createdMessage,
                    );
                }
            }

            this.statsService.incrementMessage(type);
            if (file) {
                const provider =
                    type === MessageEnumType.IMAGE
                        ? MediaProviderEnum.CLOUDINARY
                        : MediaProviderEnum.R2;
                this.statsService.incrementUploadBytes(provider, file.size);
            }

            return { message, conversation, events };
        } catch (error) {
            await this.messageMediaService.rollbackUploadedMessageMedia(
                uploadedFile,
            );
            throw error;
        } finally {
            if (!isExternalSession) {
                await session.endSession();
            }
        }
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
        const checkMessage =
            await this.messageLookupService.checkMessageExistInConversation(
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
        if (checkMessage.callId) {
            throw new BadRequestException(
                MESSAGE_MESSAGES.CALL_MESSAGE_ACTION_NOT_ALLOWED,
            );
        }
        const objectMessageId = toObjectId(messageId, 'message id');
        const shouldClearPin =
            conversation.pinMessageId?.equals(objectMessageId);

        const session = await this.connection.startSession();
        try {
            await session.withTransaction(async () => {
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
                        { returnDocument: 'after', session },
                    )
                    .lean();

                if (checkMessage.mediaId) {
                    await this.mediaService.softDeleteMediaWithMessage(
                        checkMessage.mediaId.toString(),
                        conversationId,
                        session,
                    );
                }

                if (shouldClearPin) {
                    await this.conversationService.unpinMessage(
                        conversationId,
                        session,
                    );
                }
            });

            if (shouldClearPin) {
                this.messageEventService.unpinnedMessage$.next({
                    conversationId,
                    messageId,
                });
            }

            return MESSAGE_MESSAGES.DELETE_SUCCESS;
        } finally {
            await session.endSession();
        }
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
            })
            .populate({
                path: 'senderId',
                select: '-password -email -phone -__v',
                populate: { path: 'avatar', select: '-__v' },
            })
            .populate('replyTo', '-__v')
            .populate('mediaId', '-__v')
            .populate('callId', '-__v')
            .lean();

        if (!message) {
            throw new BadRequestException(MESSAGE_MESSAGES.MESSAGE_NOT_FOUND);
        }
        if (message.type !== MessageEnumType.TEXT) {
            throw new BadRequestException(
                MESSAGE_MESSAGES.MESSAGE_ACTION_NOT_ALLOWED,
            );
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
                { returnDocument: 'after' },
            )
            .populate({
                path: 'senderId',
                select: '-password -email -phone -__v',
                populate: { path: 'avatar', select: '-__v' },
            })
            .populate('replyTo', '-__v')
            .populate('mediaId', '-__v')
            .populate('callId', '-__v')
            .lean();
        if (!updatedMessage) {
            throw new BadRequestException(MESSAGE_MESSAGES.MESSAGE_NOT_UPDATED);
        }
        const res = serializeMessage(updatedMessage);
        this.messageEventService.updatedMessage$.next(res);
        return res;
    }
}
