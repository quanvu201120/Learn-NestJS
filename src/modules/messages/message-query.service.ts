/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
    BadRequestException,
    forwardRef,
    Inject,
    Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { GLOBAL_CONSTANTS } from '@/common/constants/global.constant';
import { parseDateOrThrow } from '@/utils/utils';
import { ConversationsService } from '../conversations/conversations.service';
import { RelationshipsService } from '../relationships/relationships.service';
import { MESSAGE_MESSAGES } from './constants/message.constant';
import { Message, MessageDocument } from './schemas/message.schema';
import { serializeMessage } from './utils/message.serializer';

@Injectable()
export class MessageQueryService {
    constructor(
        @InjectModel(Message.name)
        private readonly messageModel: Model<MessageDocument>,
        @Inject(forwardRef(() => ConversationsService))
        private readonly conversationService: ConversationsService,
        @Inject(forwardRef(() => RelationshipsService))
        private readonly relationshipsService: RelationshipsService,
    ) {}

    /**
     * Lấy tin nhắn mới nhất của một cuộc trò chuyện dựa trên lastMessageId.
     */
    async getLatestMessageOfConversation(
        conversationId: string,
        currentUserId?: string,
    ) {
        const { conversation } =
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
            .populate({
                path: 'senderId',
                select: '-password -email -phone -__v',
                populate: { path: 'avatar', select: '-__v' },
            })
            .populate('replyTo', '-__v')
            .populate('mediaId', '-__v')
            .populate('callId', '-__v')
            .lean();
        if (!lastMessage) {
            throw new BadRequestException(MESSAGE_MESSAGES.MESSAGE_NOT_FOUND);
        }
        const hiddenUserIds =
            currentUserId && conversation.users?.length
                ? await this.getHiddenUserIdsForConversation(
                      conversation,
                      currentUserId,
                  )
                : [];
        return serializeMessage(lastMessage, hiddenUserIds);
    }

    private async getHiddenUserIdsForConversation(
        conversation: any,
        currentUserId: string,
    ) {
        return await this.relationshipsService.getBlockedUserIdsAmongUsers(
            currentUserId,
            conversation.users.map((user: any) => user.toString()),
        );
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

        const hiddenUserIds = await this.getHiddenUserIdsForConversation(
            conversation,
            userId,
        );

        const result = await this.messageModel
            .find({
                conversationId: objectConversationId,
                ...(Object.keys(createdAtFilter).length > 0
                    ? { createdAt: createdAtFilter }
                    : {}),
            })
            .select('-__v')
            .populate({
                path: 'senderId',
                select: '-password -email -phone -__v',
                populate: { path: 'avatar', select: '-__v' },
            })
            .populate('replyTo', '-__v')
            .populate('mediaId', '-__v')
            .populate('callId', '-__v')
            .sort({ createdAt: -1 })
            .limit(GLOBAL_CONSTANTS.LIMIT_MESSAGES_DEFAULT)
            .lean();
        if (result.length === 0) {
            return { nextCursor: null, messages: [] };
        }
        const messages = result.map((message) =>
            serializeMessage(message, hiddenUserIds),
        );

        const hasNextPage =
            messages.length === GLOBAL_CONSTANTS.LIMIT_MESSAGES_DEFAULT;
        const lastMessage = messages[messages.length - 1];
        const nextCursor = hasNextPage
            ? new Date(lastMessage.createdAt!).toISOString()
            : null;
        return { nextCursor, messages };
    }
}
