/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { CONVERSATION_MESSAGES } from './constants/conversation.constant';
import {
    BadRequestException,
    Inject,
    Injectable,
    forwardRef,
} from '@nestjs/common';
import { toObjectId } from '@/utils/utils';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
    Conversation,
    ConversationDocument,
} from './schemas/conversation.schema';
import { serializeMessage } from '../messages/utils/message.serializer';
import { MessagesService } from '../messages/messages.service';
import { UsersService } from '../users/users.service';
import { ConversationResponse } from './types/conversation';

@Injectable()
export class ConversationsService {
    constructor(
        @InjectModel(Conversation.name)
        private readonly conversationModel: Model<ConversationDocument>,

        @Inject(forwardRef(() => MessagesService))
        private readonly messageService: MessagesService,

        @Inject(forwardRef(() => UsersService))
        private readonly userService: UsersService,
    ) {}

    private serializeConversation(conversation: any): ConversationResponse {
        const { lastMessageId, ...rest } = conversation;

        return {
            ...rest,
            lastMessage: lastMessageId
                ? typeof lastMessageId === 'object' && '_id' in lastMessageId
                    ? serializeMessage(lastMessageId)
                    : lastMessageId
                : undefined,
        };
    }

    async createConversation(
        createConversationDto: CreateConversationDto,
        currentUserId: string,
    ) {
        const { users = [], isGroup = false, name } = createConversationDto;
        const objectCurrentUserId = toObjectId(currentUserId, 'user id');

        const normalizedUsers = [...new Set([currentUserId, ...users])];

        if (!isGroup) {
            if (normalizedUsers.length !== 2) {
                throw new BadRequestException(
                    CONVERSATION_MESSAGES.DIRECT_MUST_BE_2_USERS,
                );
            }
        }
        if (isGroup) {
            if (!name?.trim()) {
                throw new BadRequestException(
                    CONVERSATION_MESSAGES.GROUP_NAME_REQUIRED,
                );
            }

            if (normalizedUsers.length < 3) {
                throw new BadRequestException(
                    CONVERSATION_MESSAGES.GROUP_MIN_3_USERS,
                );
            }
        }
        const listMember = normalizedUsers.map((id) =>
            toObjectId(id, `user id`),
        );

        const existingUsersCount =
            await this.userService.countUserIdsExist(listMember);

        if (existingUsersCount !== listMember.length) {
            throw new BadRequestException(
                CONVERSATION_MESSAGES.USERS_NOT_EXIST,
            );
        }

        // 1. Nếu là chat 1-1, kiểm tra xem đã tồn tại cuộc trò chuyện nào chưa
        if (!isGroup) {
            const existingConversation = await this.conversationModel
                .findOne({
                    isGroup: false,
                    users: {
                        $all: listMember,
                        $size: 2,
                    },
                })
                .select('-__v')
                .populate('users', '-password -__v')
                .populate('lastMessageId', '-__v')
                .lean();

            if (existingConversation) {
                const isRemove = existingConversation.hiddenHistory?.find(
                    (item) =>
                        item.userId.equals(currentUserId) &&
                        item.isHidden === true,
                );
                if (isRemove) {
                    const updatedConversation = await this.conversationModel
                        .findByIdAndUpdate(
                            existingConversation._id,
                            {
                                $set: {
                                    'hiddenHistory.$[item].isHidden': false,
                                },
                            },
                            {
                                new: true,
                                arrayFilters: [
                                    {
                                        'item.userId': new Types.ObjectId(
                                            currentUserId,
                                        ),
                                    },
                                ],
                            },
                        )
                        .select('-__v')
                        .populate('users', '-password -__v')
                        .populate('lastMessageId', '-__v')
                        .lean();

                    return this.serializeConversation(updatedConversation);
                }
                return this.serializeConversation(existingConversation);
            }
        }
        const adminGroupId = isGroup ? objectCurrentUserId : undefined;
        const hiddenHistory = !isGroup
            ? listMember
                  .filter((member) => !member.equals(objectCurrentUserId))
                  .map((member) => ({
                      userId: member,
                      isHidden: true,
                      hiddenAt: new Date(),
                  }))
            : undefined;
        // 2. Nếu là group chat hoặc phòng 1-1 chưa tồn tại -> Tiến hành tạo mới
        const createConversation = await this.conversationModel.create({
            name,
            isGroup,
            users: listMember,
            adminGroupId,
            hiddenHistory,
        });
        const { __v, ...result } = (
            createConversation as ConversationDocument
        ).toObject();
        return this.serializeConversation(result);
    }

    async findAllByUser(userId: string) {
        const objectUserId = toObjectId(userId, 'user id');
        const user = await this.userService.findOne(userId);
        if (!user) {
            throw new BadRequestException(CONVERSATION_MESSAGES.USER_NOT_FOUND);
        }
        const res = await this.conversationModel
            .find({
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
            .populate('users', '-password -__v')
            .populate('lastMessageId', '-__v')
            .sort({ updatedAt: -1 })
            .lean();
        return res.map((conversation) =>
            this.serializeConversation(conversation),
        );
    }

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
            .populate('users', '-password -__v')
            .populate('lastMessageId', '-__v')
            .lean();
        return res ? this.serializeConversation(res) : null;
    }

    async updateLastMessageAndRestoreConversation(
        id: string,
        messageId: string,
        userId: string,
        session?: ClientSession,
    ) {
        const objectConversationId = toObjectId(id, 'conversation id');
        const objectMessageId = toObjectId(messageId, 'message id');
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
            { new: true, arrayFilters: [{ 'item.isHidden': true }], session },
        );
        return result;
    }

    async updateNameConversation(
        id: string,
        currentUserId: string,
        name: string,
    ) {
        const { conversation, objectConversationId } =
            await this.getConversationOrThrow(id);

        this.ensureGroupConversation(conversation);
        this.ensureGroupAdmin(conversation, currentUserId);

        if (!name.trim()) {
            throw new BadRequestException(CONVERSATION_MESSAGES.NAME_REQUIRED);
        }
        const result = await this.conversationModel
            .findByIdAndUpdate(
                objectConversationId,
                { $set: { name } },
                { new: true },
            )
            .select('-__v')
            .populate('users', '-password -__v')
            .populate('lastMessageId', '-__v')
            .lean();
        return result ? this.serializeConversation(result) : null;
    }

    async addMembers(id: string, currentUserId: string, memberIds: string[]) {
        const { conversation, objectConversationId } =
            await this.getConversationOrThrow(id);
        const objectMemberIds = memberIds.map((memberId) =>
            toObjectId(memberId, `member id`),
        );

        this.ensureGroupConversation(conversation);
        this.ensureGroupAdmin(conversation, currentUserId);

        const checkuser =
            await this.userService.countUserIdsExist(objectMemberIds);
        if (checkuser !== objectMemberIds.length) {
            throw new BadRequestException(
                CONVERSATION_MESSAGES.USERS_NOT_EXIST,
            );
        }
        const result = await this.conversationModel
            .findByIdAndUpdate(
                objectConversationId,
                {
                    $addToSet: {
                        users: {
                            $each: objectMemberIds,
                        },
                    },
                },
                { new: true },
            )
            .select('-__v')
            .populate('users', '-password -__v')
            .populate('lastMessageId', '-__v')
            .lean();

        return result ? this.serializeConversation(result) : null;
    }

    async removeMember(id: string, currentUserId: string, memberId: string) {
        const { conversation, objectConversationId } =
            await this.getConversationOrThrow(id);

        this.ensureGroupConversation(conversation);
        this.ensureGroupAdmin(conversation, currentUserId);

        if (currentUserId === memberId) {
            throw new BadRequestException(
                CONVERSATION_MESSAGES.CANNOT_REMOVE_SELF,
            );
        }

        const objectMemberId = this.ensureMemberInConversation(
            conversation,
            memberId,
        );

        const result = await this.conversationModel
            .findByIdAndUpdate(
                objectConversationId,
                {
                    $pull: {
                        users: objectMemberId,
                        hiddenHistory: { userId: objectMemberId },
                    },
                    $unset: {
                        [`readReceipts.${memberId}`]: 1,
                    },
                },
                { new: true },
            )
            .select('-__v')
            .populate('users', '-password -__v')
            .populate('lastMessageId', '-__v')
            .lean();

        return result ? this.serializeConversation(result) : null;
    }

    async hiddenHistory(conversationId: string, userId: string) {
        const { conversation, objectConversationId } =
            await this.getConversationOrThrow(conversationId);

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
        let result: any = null;
        if (userhiddenHistory) {
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
                    {
                        $set: {
                            'hiddenHistory.$.isHidden': true,
                            'hiddenHistory.$.hiddenAt': new Date(),
                        },
                    },
                    { new: true },
                )
                .lean();
        } else {
            result = await this.conversationModel
                .findOneAndUpdate(
                    {
                        _id: objectConversationId,
                        'hiddenHistory.userId': { $ne: objectUserId },
                    },
                    {
                        $push: {
                            hiddenHistory: {
                                userId: objectUserId,
                                isHidden: true,
                                hiddenAt: new Date(),
                            },
                        },
                    },
                    { new: true },
                )
                .lean();
        }

        if (result) {
            return CONVERSATION_MESSAGES.DELETE_SUCCESS;
        }
        throw new BadRequestException(CONVERSATION_MESSAGES.DELETE_FAILED);
    }

    async markAsRead(
        conversationId: string,
        userId: string,
        messageId: string,
    ) {
        const { conversation, objectConversationId } =
            await this.getConversationOrThrow(conversationId);
        const { objectMessageId } = await this.getMessageInConverOrThrow(
            messageId,
            conversationId,
        );
        this.ensureMemberInConversation(conversation, userId);
        const lastReadMessageId = conversation.readReceipts?.get(userId);

        if (
            lastReadMessageId &&
            this.isObjectIdAfter(lastReadMessageId, objectMessageId)
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
            { new: true },
        );
    }

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

    async getMessageInConverOrThrow(messageId: string, conversationId: string) {
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
        return { message, objectMessageId };
    }

    async getConversationOrThrow(conversationId: string) {
        const objectConversationId = toObjectId(
            conversationId,
            'conversation id',
        );
        const conversation =
            await this.conversationModel.findById(objectConversationId);

        if (!conversation) {
            throw new BadRequestException(
                CONVERSATION_MESSAGES.CONVERSATION_NOT_FOUND,
            );
        }

        return { conversation, objectConversationId };
    }

    ensureGroupConversation(conversation: ConversationDocument) {
        if (!conversation.isGroup) {
            throw new BadRequestException(
                CONVERSATION_MESSAGES.DIRECT_ACTION_NOT_ALLOWED,
            );
        }
    }

    ensureGroupAdmin(
        conversation: ConversationDocument,
        currentUserId: string,
    ) {
        const objectCurrentUserId = toObjectId(currentUserId, 'user id');

        if (!conversation.adminGroupId?.equals(objectCurrentUserId)) {
            throw new BadRequestException(
                CONVERSATION_MESSAGES.NOT_GROUP_ADMIN,
            );
        }

        return objectCurrentUserId;
    }

    ensureMemberInConversation(
        conversation: ConversationDocument,
        memberId: string,
    ) {
        const objectMemberId = toObjectId(memberId, 'member id');
        const isMember = conversation.users.some((member) =>
            member.equals(objectMemberId),
        );

        if (!isMember) {
            throw new BadRequestException(
                CONVERSATION_MESSAGES.USER_NOT_IN_CONVERSATION,
            );
        }

        return objectMemberId;
    }

    isObjectIdAfter(currentId: Types.ObjectId, nextId: Types.ObjectId) {
        if (currentId.equals(nextId)) {
            return false;
        }

        return currentId.toString() > nextId.toString();
    }
}
