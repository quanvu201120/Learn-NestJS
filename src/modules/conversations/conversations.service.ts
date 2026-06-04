/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
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
import { MessagesService } from '../messages/messages.service';
import { UsersService } from '../users/users.service';

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
                    'Direct conversation must have exactly 2 users',
                );
            }
        }
        if (isGroup) {
            if (!name?.trim()) {
                throw new BadRequestException('Group name is required');
            }

            if (normalizedUsers.length < 3) {
                throw new BadRequestException(
                    'Group conversation must have at least 3 users including creator',
                );
            }
        }
        const listMember = normalizedUsers.map((id) =>
            toObjectId(id, `user id`),
        );

        const existingUsersCount =
            await this.userService.countUserIdsExist(listMember);

        if (existingUsersCount !== listMember.length) {
            throw new BadRequestException('One or more users do not exist');
        }

        // 1. Nếu là chat 1-1, kiểm tra xem đã tồn tại cuộc trò chuyện nào chưa
        if (!isGroup) {
            const existingConversation = await this.conversationModel.findOne({
                isGroup: false,
                users: {
                    $all: listMember,
                    $size: 2,
                },
            });

            if (existingConversation) {
                const isRemove = existingConversation.hiddenHistory?.find(
                    (item) =>
                        item.userId.equals(currentUserId) &&
                        item.isHidden === true,
                );
                if (isRemove) {
                    return await this.conversationModel.findByIdAndUpdate(
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
                    );
                }
                return existingConversation;
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
        const newConversation = new this.conversationModel({
            name,
            isGroup,
            users: listMember,
            adminGroupId,
            hiddenHistory,
        });

        return await newConversation.save();
    }

    async findAllByUser(userId: string) {
        const objectUserId = toObjectId(userId, 'user id');
        return await this.conversationModel
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
            .populate('users', '-password')
            .populate('lastMessageId')
            .sort({ updatedAt: -1 });
    }

    async findOne(conversationId: string, userId: string) {
        const objectConversationId = toObjectId(
            conversationId,
            'conversation id',
        );
        const objectUserId = toObjectId(userId, 'user id');
        return await this.conversationModel
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
            .populate('users', '-password')
            .populate('lastMessageId');
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
            throw new BadRequestException('Name is required');
        }
        return this.conversationModel.findByIdAndUpdate(
            objectConversationId,
            { $set: { name } },
            { new: true },
        );
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
            throw new BadRequestException('One or more users do not exist');
        }
        return this.conversationModel.findByIdAndUpdate(
            objectConversationId,
            {
                $addToSet: {
                    users: {
                        $each: objectMemberIds,
                    },
                },
            },
            { new: true },
        );
    }

    async removeMember(id: string, currentUserId: string, memberId: string) {
        const { conversation, objectConversationId } =
            await this.getConversationOrThrow(id);

        this.ensureGroupConversation(conversation);
        this.ensureGroupAdmin(conversation, currentUserId);

        if (currentUserId === memberId) {
            throw new BadRequestException(
                'Cannot remove yourself from conversation',
            );
        }

        const objectMemberId = this.ensureMemberInConversation(
            conversation,
            memberId,
        );

        return await this.conversationModel.findByIdAndUpdate(
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
        );
    }

    async hiddenHistory(conversationId: string, userId: string) {
        const { conversation, objectConversationId } =
            await this.getConversationOrThrow(conversationId);

        const objectUserId = toObjectId(userId, 'user id');
        const isExistUser = conversation.users.some(
            (user) => user.toString() === userId,
        );
        if (!isExistUser) {
            throw new BadRequestException(
                'User is not a member of conversation',
            );
        }
        const userhiddenHistory = conversation.hiddenHistory?.find(
            (item) => item.userId.toString() === userId,
        );

        if (userhiddenHistory?.isHidden) {
            throw new BadRequestException(
                'Conversation already hidden for this user',
            );
        }

        if (userhiddenHistory) {
            return await this.conversationModel.findOneAndUpdate(
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
            );
        }

        return await this.conversationModel.findOneAndUpdate(
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
        );
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
                'Cannot mark as read to an older message',
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

    async getMessageInConverOrThrow(messageId: string, conversationId: string) {
        const message =
            await this.messageService.checkMessageExistInConversation(
                messageId,
                conversationId,
            );
        if (!message) {
            throw new BadRequestException('Message not found');
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
            throw new BadRequestException('Conversation not found');
        }

        return { conversation, objectConversationId };
    }

    ensureGroupConversation(conversation: ConversationDocument) {
        if (!conversation.isGroup) {
            throw new BadRequestException(
                'Cannot perform this action on direct conversation',
            );
        }
    }

    ensureGroupAdmin(
        conversation: ConversationDocument,
        currentUserId: string,
    ) {
        const objectCurrentUserId = toObjectId(currentUserId, 'user id');

        if (!conversation.adminGroupId?.equals(objectCurrentUserId)) {
            throw new BadRequestException('You are not admin of this group');
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
            throw new BadRequestException('User is not in conversation');
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
