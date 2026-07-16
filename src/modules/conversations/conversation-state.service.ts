import {
    BadRequestException,
    Inject,
    Injectable,
    forwardRef,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model } from 'mongoose';
import { RedisService } from '@/redis/redis.service';
import { toObjectId } from '@/utils/utils';
import { MessagesService } from '../messages/messages.service';
import { RelationshipsService } from '../relationships/relationships.service';
import { CONVERSATION_MESSAGES } from './constants/conversation.constant';
import { ConversationAccessService } from './conversation-access.service';
import { ConversationEventService } from './conversation-event.service';
import {
    Conversation,
    ConversationDocument,
} from './schemas/conversation.schema';
import { UpdateNameConversationResponse } from './types/conversation';

@Injectable()
export class ConversationStateService {
    constructor(
        @InjectModel(Conversation.name)
        private readonly conversationModel: Model<ConversationDocument>,

        @InjectConnection()
        private readonly connection: Connection,

        @Inject(forwardRef(() => MessagesService))
        private readonly messageService: MessagesService,

        @Inject(forwardRef(() => RedisService))
        private readonly redisService: RedisService,

        @Inject(forwardRef(() => RelationshipsService))
        private readonly relationshipsService: RelationshipsService,

        private readonly conversationAccessService: ConversationAccessService,

        private readonly conversationEventService: ConversationEventService,
    ) {}

    /**
     * Cập nhật lastMessageId, restore hiddenHistory và set read receipt của người gửi.
     */
    async updateLastMessageAndRestoreConversation(
        id: string,
        messageId: string,
        userId: string,
        session?: ClientSession,
    ) {
        const objectConversationId = toObjectId(id, 'conversation id');
        const objectMessageId = toObjectId(messageId, 'message id');

        const _ = toObjectId(userId, 'user id');
        const result = await this.conversationModel.findByIdAndUpdate(
            objectConversationId,
            {
                $set: {
                    lastMessageId: objectMessageId,
                    'hiddenHistory.$[item].isHidden': false,
                    [`readReceipts.${userId}`]: objectMessageId,
                },
            },
            {
                returnDocument: 'after',
                arrayFilters: [{ 'item.isHidden': true }],
                session,
            },
        );
        return result;
    }

    async pinMessage(
        conversationId: string,
        messageId: string,
        session?: ClientSession,
    ) {
        const objectConversationId = toObjectId(
            conversationId,
            'conversation id',
        );
        const objectMessageId = toObjectId(messageId, 'message id');
        return await this.conversationModel.findByIdAndUpdate(
            objectConversationId,
            { $set: { pinMessageId: objectMessageId } },
            { returnDocument: 'after', session },
        );
    }

    async unpinMessage(conversationId: string, session?: ClientSession) {
        const objectConversationId = toObjectId(
            conversationId,
            'conversation id',
        );
        return await this.conversationModel.findByIdAndUpdate(
            objectConversationId,
            { $unset: { pinMessageId: 1 } },
            { returnDocument: 'after', session },
        );
    }

    /**
     * Đổi tên group chat và phát event realtime khi cập nhật thành công.
     */
    async updateNameConversation(
        id: string,
        currentUserId: string,
        name: string,
    ) {
        const { conversation, objectConversationId } =
            await this.conversationAccessService.getConversationOrThrow(id);

        this.conversationAccessService.ensureGroupConversation(conversation);
        this.conversationAccessService.ensureGroupAdmin(
            conversation,
            currentUserId,
        );
        const normalizedName = name.trim();
        if (!normalizedName) {
            throw new BadRequestException(CONVERSATION_MESSAGES.NAME_REQUIRED);
        }

        if (normalizedName === conversation.name) {
            throw new BadRequestException(
                CONVERSATION_MESSAGES.NAME_NOT_CHANGED,
            );
        }

        const result = await this.conversationModel
            .findByIdAndUpdate(
                objectConversationId,
                { $set: { name: normalizedName } },
                { returnDocument: 'after' },
            )
            .lean();
        const res: UpdateNameConversationResponse = {
            updated: !!result,
        };
        if (result) {
            this.conversationEventService.conversationNameChanged$.next({
                conversationId: id,
                name: result.name!,
            });
        }
        return res;
    }

    /**
     * Ẩn conversation khỏi danh sách của user và dọn unseen flag.
     */
    async hiddenHistory(
        conversationId: string,
        userId: string,
        session?: ClientSession,
    ) {
        const { conversation, objectConversationId } =
            await this.conversationAccessService.getConversationOrThrow(
                conversationId,
            );

        const objectUserId = toObjectId(userId, 'user id');
        const isExistUser = conversation.users.some(
            (user) => user.toString() === userId,
        );
        if (!isExistUser) {
            throw new BadRequestException(CONVERSATION_MESSAGES.NOT_A_MEMBER);
        }
        const userhiddenHistory = conversation.hiddenHistory?.find(
            (item) => item.userId.toString() === userId,
        );

        if (userhiddenHistory?.isHidden) {
            throw new BadRequestException(CONVERSATION_MESSAGES.ALREADY_HIDDEN);
        }

        let isFriend = true;
        if (!conversation.isGroup) {
            const targetId = conversation.users.find(
                (user) => user.toString() !== userId,
            );
            if (targetId) {
                isFriend = await this.relationshipsService.checkIsFriend(
                    userId,
                    targetId.toString(),
                );
            }
        }

        let result: any = null;
        if (userhiddenHistory) {
            const updateData: any = {
                $set: {
                    'hiddenHistory.$.isHidden': true,
                    'hiddenHistory.$.hiddenAt': new Date(),
                },
            };
            if (!conversation.isGroup && !isFriend) {
                updateData.$pull = { acceptedBy: objectUserId };
            }

            result = await this.conversationModel
                .findOneAndUpdate(
                    {
                        _id: objectConversationId,
                        hiddenHistory: {
                            $elemMatch: {
                                userId: objectUserId,
                                isHidden: false,
                            },
                        },
                    },
                    updateData,
                    { returnDocument: 'after', session },
                )
                .lean();
        } else {
            const updateData: any = {
                $push: {
                    hiddenHistory: {
                        userId: objectUserId,
                        isHidden: true,
                        hiddenAt: new Date(),
                    },
                },
            };
            if (!conversation.isGroup && !isFriend) {
                updateData.$pull = { acceptedBy: objectUserId };
            }

            result = await this.conversationModel
                .findOneAndUpdate(
                    {
                        _id: objectConversationId,
                        'hiddenHistory.userId': { $ne: objectUserId },
                    },
                    updateData,
                    { returnDocument: 'after', session },
                )
                .lean();
        }

        if (result) {
            await this.redisService.removeUnseenConversationWithCleanup(
                userId,
                conversationId,
            );
            return CONVERSATION_MESSAGES.DELETE_SUCCESS;
        }
        throw new BadRequestException(CONVERSATION_MESSAGES.DELETE_FAILED);
    }

    /**
     * Block người còn lại trong direct conversation và ẩn conversation hiện tại.
     */
    async blockAndDelete(conversationId: string, userId: string) {
        const objectUserId = toObjectId(userId, 'user id');
        const session = await this.connection.startSession();
        try {
            await session.withTransaction(async () => {
                const { conversation } =
                    await this.conversationAccessService.getConversationOrThrow(
                        conversationId,
                    );
                this.conversationAccessService.ensureMemberInConversation(
                    conversation,
                    userId,
                );
                if (conversation.isGroup) {
                    throw new BadRequestException(
                        CONVERSATION_MESSAGES.CANNOT_BLOCK_IN_GROUP,
                    );
                }

                const blockUser = conversation.users.find(
                    (user) => user.toString() !== objectUserId.toString(),
                );

                if (!blockUser) {
                    throw new BadRequestException(
                        CONVERSATION_MESSAGES.USER_NOT_FOUND,
                    );
                }

                await this.relationshipsService.blockUser(
                    objectUserId.toString(),
                    blockUser.toString(),
                    session,
                );
                await this.hiddenHistory(conversationId, userId, session);
            });
            return true;
        } finally {
            await session.endSession();
        }
    }

    /**
     * Đánh dấu user đã đọc đến message cụ thể trong conversation.
     */
    async markAsRead(
        conversationId: string,
        userId: string,
        messageId: string,
    ) {
        const { conversation, objectConversationId } =
            await this.conversationAccessService.getConversationOrThrow(
                conversationId,
            );
        const message =
            await this.messageService.checkMessageExistInConversation(
                messageId,
                conversationId,
            );
        if (!message) {
            throw new BadRequestException(
                CONVERSATION_MESSAGES.MESSAGE_NOT_FOUND,
            );
        }
        const objectMessageId = toObjectId(messageId, 'message id');
        this.conversationAccessService.ensureMemberInConversation(
            conversation,
            userId,
        );
        const lastReadMessageId = conversation.readReceipts?.get(userId);

        if (
            lastReadMessageId &&
            this.conversationAccessService.isObjectIdAfter(
                lastReadMessageId,
                objectMessageId,
            )
        ) {
            throw new BadRequestException(
                CONVERSATION_MESSAGES.CANNOT_READ_OLDER,
            );
        }
        return await this.conversationModel.findByIdAndUpdate(
            objectConversationId,
            {
                $set: {
                    [`readReceipts.${userId}`]: objectMessageId,
                },
            },
            { returnDocument: 'after' },
        );
    }
}
