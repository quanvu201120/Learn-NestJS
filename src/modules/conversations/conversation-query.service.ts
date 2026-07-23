/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { GLOBAL_CONSTANTS } from '@/common/constants/global.constant';
import {
    BadRequestException,
    Inject,
    Injectable,
    forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RelationshipsService } from '../relationships/relationships.service';
import { UsersService } from '../users/users.service';
import { CONVERSATION_MESSAGES } from './constants/conversation.constant';
import {
    Conversation,
    ConversationDocument,
} from './schemas/conversation.schema';
import { ConversationSerializerService } from './conversation-serializer.service';
import { ListConversationResponse } from './types/conversation';
import { toObjectId } from '@/utils/utils';

@Injectable()
export class ConversationQueryService {
    constructor(
        @InjectModel(Conversation.name)
        private readonly conversationModel: Model<ConversationDocument>,

        @Inject(forwardRef(() => UsersService))
        private readonly userService: UsersService,

        @Inject(forwardRef(() => RelationshipsService))
        private readonly relationshipsService: RelationshipsService,

        private readonly conversationSerializerService: ConversationSerializerService,
    ) {}

    /**
     * Lấy toàn bộ danh sách phòng chat mà user hiện tại tham gia,
     * bỏ qua các phòng chat đã bị user ẩn đi (hiddenHistory).
     * Lấy danh sách phòng chat phân trang theo cursor (updatedAt)
     */
    async findAllByUser(
        userId: string,
        cursor?: string,
        limit: number = GLOBAL_CONSTANTS.LIMIT_CONVERSATIONS_DEFAULT,
    ) {
        const objectUserId = toObjectId(userId, 'user id');
        const user = await this.userService.findOne(userId);
        if (!user) {
            throw new BadRequestException(CONVERSATION_MESSAGES.USER_NOT_FOUND);
        }

        const query: any = {
            users: objectUserId,
            hiddenHistory: {
                $not: {
                    $elemMatch: {
                        userId: objectUserId,
                        isHidden: true,
                    },
                },
            },
        };

        if (cursor) {
            query.updatedAt = { $lt: new Date(cursor) };
        }

        const resultList = await this.conversationModel
            .find(query)
            .select('-__v')
            .populate({
                path: 'users',
                select: '-password -email -phone -__v',
                populate: { path: 'avatar', select: '-__v' },
            })
            .populate('lastMessageId', '-__v')
            .populate({
                path: 'pinMessageId',
                select: '-__v',
                populate: [
                    {
                        path: 'senderId',
                        select: '-password -email -phone -__v',
                        populate: { path: 'avatar', select: '-__v' },
                    },
                    { path: 'replyTo', select: '-__v' },
                    { path: 'mediaId', select: '-__v' },
                ],
            })
            .populate('avatar', '-__v')
            .sort({ updatedAt: -1 })
            .limit(limit + 1)
            .lean();

        const hasNextPage = resultList.length > limit;
        const conversations = hasNextPage
            ? resultList.slice(0, -1)
            : resultList;

        const nextCursor =
            conversations.length > 0
                ? (
                      conversations[conversations.length - 1] as any
                  ).updatedAt.toISOString()
                : null;
        const hiddenUserIds =
            await this.relationshipsService.getBlockedUserIdsAmongUsers(
                userId,
                [
                    ...new Set(
                        conversations.flatMap((conversation: any) => {
                            return Array.isArray(conversation.users)
                                ? conversation.users.map((user: any) =>
                                      user._id.toString(),
                                  )
                                : [];
                        }),
                    ),
                ],
            );

        const res: ListConversationResponse = {
            nextCursor,
            conversations: await Promise.all(
                conversations.map((conversation) =>
                    this.conversationSerializerService.serializeConversation(
                        conversation as any,
                        userId,
                        hiddenUserIds,
                        conversation.isGroup,
                    ),
                ),
            ),
        };
        return res;
    }

    /**
     * Lấy chi tiết một phòng chat theo ID (dành cho user hiện tại).
     */
    async findOne(conversationId: string, userId: string) {
        const objectConversationId = toObjectId(
            conversationId,
            'conversation id',
        );
        const objectUserId = toObjectId(userId, 'user id');
        const res = await this.conversationModel
            .findOne({
                _id: objectConversationId,
                users: objectUserId,
                hiddenHistory: {
                    $not: {
                        $elemMatch: {
                            userId: objectUserId,
                            isHidden: true,
                        },
                    },
                },
            })
            .select('-__v')
            .populate({
                path: 'users',
                select: '-password -email -phone -__v',
                populate: { path: 'avatar', select: '-__v' },
            })
            .populate('lastMessageId', '-__v')
            .populate({
                path: 'pinMessageId',
                select: '-__v',
                populate: [
                    {
                        path: 'senderId',
                        select: '-password -email -phone -__v',
                        populate: { path: 'avatar', select: '-__v' },
                    },
                    { path: 'replyTo', select: '-__v' },
                    { path: 'mediaId', select: '-__v' },
                ],
            })
            .populate('avatar', '-__v')
            .lean();
        return res
            ? await this.conversationSerializerService.serializeConversation(
                  res,
                  userId,
                  undefined,
                  res.isGroup,
              )
            : null;
    }

    /**
     * Lấy mảng tất cả các Conversation ID mà user đang tham gia (Dùng để khởi tạo Socket Join).
     */
    async getAllConversationIdsByUser(userId: string): Promise<string[]> {
        const objectUserId = toObjectId(userId, 'user id');

        const res = await this.conversationModel
            .find({
                users: objectUserId,
            })
            .select('_id')
            .lean();

        return res.map((conv) => conv._id.toString());
    }
}
