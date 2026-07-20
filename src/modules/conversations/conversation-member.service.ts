/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
    BadRequestException,
    Inject,
    Injectable,
    forwardRef,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { toObjectId } from '@/utils/utils';
import { RedisService } from '@/redis/redis.service';
import { MessagesService } from '../messages/messages.service';
import {
    MessageCreatedEvents,
    MessageEnumType,
} from '../messages/types/message';
import { RelationshipsService } from '../relationships/relationships.service';
import { UsersService } from '../users/users.service';
import {
    CONVERSATION_CONSTANTS,
    CONVERSATION_MESSAGES,
} from './constants/conversation.constant';
import { ConversationAccessService } from './conversation-access.service';
import { ConversationEventService } from './conversation-event.service';
import { ConversationSerializerService } from './conversation-serializer.service';
import {
    Conversation,
    ConversationDocument,
} from './schemas/conversation.schema';

@Injectable()
export class ConversationMemberService {
    constructor(
        @InjectModel(Conversation.name)
        private readonly conversationModel: Model<ConversationDocument>,
        @InjectConnection()
        private readonly connection: Connection,

        @Inject(forwardRef(() => MessagesService))
        private readonly messageService: MessagesService,

        @Inject(forwardRef(() => UsersService))
        private readonly userService: UsersService,

        @Inject(forwardRef(() => RedisService))
        private readonly redisService: RedisService,

        @Inject(forwardRef(() => RelationshipsService))
        private readonly relationshipsService: RelationshipsService,

        private readonly conversationAccessService: ConversationAccessService,

        private readonly conversationSerializerService: ConversationSerializerService,

        private readonly conversationEventService: ConversationEventService,
    ) {}

    /**
     * Thêm thành viên mới vào group chat, bỏ qua user không hợp lệ hoặc đang bị chặn,
     * gửi system message và phát realtime event cho các client liên quan.
     */
    async addMembers(id: string, currentUserId: string, memberIds: string[]) {
        const { conversation, objectConversationId } =
            await this.conversationAccessService.getConversationOrThrow(id);
        const objectMemberIds = memberIds.map((memberId) =>
            toObjectId(memberId, `member id`),
        );
        const existingMemberIds = new Set(
            conversation.users.map((member) => member.toString()),
        );
        const uniqueMemberIds = [
            ...new Map(
                objectMemberIds.map((memberId) => [
                    memberId.toString(),
                    memberId,
                ]),
            ).values(),
        ];

        this.conversationAccessService.ensureGroupConversation(conversation);
        this.conversationAccessService.ensureGroupAdmin(
            conversation,
            currentUserId,
        );

        const validMemberIds = (
            await Promise.all(
                uniqueMemberIds.map(async (memberId) => {
                    const memberIdString = memberId.toString();

                    if (existingMemberIds.has(memberIdString)) {
                        return null;
                    }

                    const user = await this.userService.findOne(memberIdString);
                    if (
                        !user ||
                        user.isDisabled ||
                        !user.isActive ||
                        (user.banUntil && user.banUntil > new Date())
                    ) {
                        return null;
                    }

                    const isBlocked =
                        await this.relationshipsService.checkIsBlocked(
                            currentUserId,
                            memberIdString,
                        );
                    if (isBlocked) {
                        return null;
                    }

                    return memberId;
                }),
            )
        ).filter((memberId): memberId is Types.ObjectId => memberId !== null);

        if (validMemberIds.length === 0) {
            throw new BadRequestException(
                CONVERSATION_MESSAGES.USERS_NOT_EXIST,
            );
        }

        if (
            conversation.users.length + validMemberIds.length >
            CONVERSATION_CONSTANTS.MAX_GROUP_MEMBERS
        ) {
            throw new BadRequestException(
                CONVERSATION_MESSAGES.GROUP_MAX_MEMBERS_EXCEEDED,
            );
        }

        const session = await this.connection.startSession();
        let result: any = null;
        let messageEvents: MessageCreatedEvents | undefined;

        try {
            await session.withTransaction(async () => {
                result = await this.conversationModel
                    .findByIdAndUpdate(
                        objectConversationId,
                        {
                            $addToSet: {
                                users: {
                                    $each: validMemberIds,
                                },
                            },
                            $push: {
                                hiddenHistory: {
                                    $each: validMemberIds.map((memberId) => ({
                                        userId: memberId,
                                        isHidden: false,
                                        hiddenAt: new Date(),
                                    })),
                                },
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

                if (result) {
                    const addedUsers = result.users as any[];
                    const addedNames = addedUsers
                        .filter((u) =>
                            validMemberIds.some((memberId) =>
                                memberId.equals(u._id),
                            ),
                        )
                        .map((u) => u.name)
                        .join(', ');

                    const createdMessage =
                        await this.messageService.createMessage(
                            currentUserId,
                            id,
                            MessageEnumType.SYSTEM,
                            CONVERSATION_MESSAGES.SYSTEM_ADDED_MEMBERS(
                                addedNames,
                            ),
                            undefined,
                            undefined,
                            session,
                        );
                    messageEvents = createdMessage.events;
                }
            });
        } finally {
            await session.endSession();
        }

        if (result) {
            this.messageService.emitCreatedMessageEvents(messageEvents);
            this.conversationEventService.memberAdded$.next({
                conversationId: id,
                addedMemberIds: validMemberIds.map((memberId) =>
                    memberId.toString(),
                ),
                adderId: currentUserId,
            });
            return await this.conversationSerializerService.serializeConversation(
                result,
                currentUserId,
                [],
                true,
            );
        }
        return null;
    }

    /**
     * Xóa một thành viên khỏi group chat hoặc để chính thành viên tự rời nhóm.
     * Hàm đồng thời dọn hiddenHistory, readReceipts, unseen flag, gửi system message
     * và phát realtime event để các client cập nhật trạng thái.
     */
    async removeMember(id: string, currentUserId: string, memberId: string) {
        const { conversation, objectConversationId } =
            await this.conversationAccessService.getConversationOrThrow(id);

        this.conversationAccessService.ensureGroupConversation(conversation);
        if (currentUserId !== memberId) {
            this.conversationAccessService.ensureGroupAdmin(
                conversation,
                currentUserId,
            );
        }

        if (
            currentUserId === memberId &&
            currentUserId === conversation.adminGroupId?.toString()
        ) {
            throw new BadRequestException(
                CONVERSATION_MESSAGES.CANNOT_REMOVE_ADMIN,
            );
        }

        const objectMemberId =
            this.conversationAccessService.ensureMemberInConversation(
                conversation,
                memberId,
            );
        const removedUser = await this.userService.findOne(memberId);
        const removedName = removedUser?.name || memberId;

        const messageContent =
            currentUserId === memberId
                ? CONVERSATION_MESSAGES.SYSTEM_LEFT_GROUP(removedName)
                : CONVERSATION_MESSAGES.SYSTEM_REMOVED_FROM_GROUP(removedName);
        const session = await this.connection.startSession();
        let result: any = null;
        let messageEvents: MessageCreatedEvents | undefined;

        try {
            await session.withTransaction(async () => {
                result = await this.conversationModel
                    .findByIdAndUpdate(
                        objectConversationId,
                        {
                            $pull: {
                                users: objectMemberId,
                                hiddenHistory: { userId: objectMemberId },
                                acceptedBy: objectMemberId,
                            },
                            $unset: {
                                [`readReceipts.${memberId}`]: 1,
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

                if (!result) {
                    throw new BadRequestException(
                        CONVERSATION_MESSAGES.CONVERSATION_NOT_FOUND,
                    );
                }

                const createdMessage = await this.messageService.createMessage(
                    currentUserId,
                    id,
                    MessageEnumType.SYSTEM,
                    messageContent,
                    undefined,
                    undefined,
                    session,
                );
                messageEvents = createdMessage.events;
            });
        } finally {
            await session.endSession();
        }

        this.messageService.emitCreatedMessageEvents(messageEvents);
        await this.redisService.removeUnseenConversationWithCleanup(
            memberId,
            id,
        );

        this.conversationEventService.memberRemoved$.next({
            conversationId: id,
            removedMemberId: memberId,
            removerId: currentUserId,
        });

        return { remove: result ? true : false };
    }
}
