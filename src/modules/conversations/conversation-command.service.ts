import {
    BadRequestException,
    ForbiddenException,
    forwardRef,
    Inject,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { toObjectId } from '@/utils/utils';
import { RelationshipsService } from '../relationships/relationships.service';
import { StatsService } from '../stats/stats.service';
import { UsersService } from '../users/users.service';
import {
    CONVERSATION_CONSTANTS,
    CONVERSATION_MESSAGES,
} from './constants/conversation.constant';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { ConversationEventService } from './conversation-event.service';
import { ConversationSerializerService } from './conversation-serializer.service';
import {
    Conversation,
    ConversationDocument,
} from './schemas/conversation.schema';

@Injectable()
export class ConversationCommandService {
    constructor(
        @InjectModel(Conversation.name)
        private readonly conversationModel: Model<ConversationDocument>,

        @Inject(forwardRef(() => UsersService))
        private readonly userService: UsersService,

        @Inject(forwardRef(() => RelationshipsService))
        private readonly relationshipsService: RelationshipsService,

        private readonly statsService: StatsService,

        private readonly conversationSerializerService: ConversationSerializerService,

        private readonly conversationEventService: ConversationEventService,
    ) {}

    /**
     * Tạo conversation mới hoặc khôi phục conversation 1-1 đã tồn tại.
     */
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

            if (
                normalizedUsers.length >
                CONVERSATION_CONSTANTS.MAX_GROUP_MEMBERS
            ) {
                throw new BadRequestException(
                    CONVERSATION_MESSAGES.GROUP_MAX_MEMBERS_EXCEEDED,
                );
            }
        }
        const blockList = new Set(
            await this.relationshipsService.getBlockedUserIdsAmongUsers(
                currentUserId,
                users,
            ),
        );

        const listMember = normalizedUsers
            .map((id) => toObjectId(id, `user id`))
            .filter((member) => !blockList.has(member.toString()));

        if (!isGroup && listMember.length !== 2) {
            throw new BadRequestException(
                CONVERSATION_MESSAGES.DIRECT_MUST_BE_2_USERS,
            );
        }

        if (isGroup && listMember.length < 3) {
            throw new BadRequestException(
                CONVERSATION_MESSAGES.GROUP_MIN_3_USERS,
            );
        }

        const existingUsersCount =
            await this.userService.countUserIdsExist(listMember);

        if (existingUsersCount !== listMember.length) {
            throw new BadRequestException(
                CONVERSATION_MESSAGES.USERS_NOT_EXIST,
            );
        }

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
                .populate({
                    path: 'users',
                    select: '-password -email -phone -__v',
                    populate: { path: 'avatar', select: '-__v' },
                })
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
                                $push: {
                                    acceptedBy: objectCurrentUserId,
                                },
                            },
                            {
                                returnDocument: 'after',
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
                        .populate({
                            path: 'users',
                            select: '-password -email -phone -__v',
                            populate: { path: 'avatar', select: '-__v' },
                        })
                        .populate('lastMessageId', '-__v')
                        .lean();

                    return await this.conversationSerializerService.serializeConversation(
                        updatedConversation,
                    );
                }
                return await this.conversationSerializerService.serializeConversation(
                    existingConversation,
                );
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
        const acceptedBy: Types.ObjectId[] = [objectCurrentUserId];

        if (!isGroup) {
            const targetId = users.find((id) => id !== currentUserId);
            if (targetId) {
                const isFriend = await this.relationshipsService.checkIsFriend(
                    currentUserId,
                    targetId,
                );
                if (isFriend) {
                    acceptedBy.push(toObjectId(targetId, 'user id'));
                }
            }
        } else {
            const otherUserIds = users.filter((id) => id !== currentUserId);
            const friendIds =
                await this.relationshipsService.getFriendIdsAmongUsers(
                    currentUserId,
                    otherUserIds,
                );

            for (const friendId of friendIds) {
                acceptedBy.push(toObjectId(friendId, 'user id'));
            }
        }

        const createConversation = await this.conversationModel.create({
            name,
            isGroup,
            users: listMember,
            adminGroupId,
            hiddenHistory,
            acceptedBy,
        });
        const { __v, ...result } = (
            createConversation as ConversationDocument
        ).toObject();
        const res =
            await this.conversationSerializerService.serializeConversation(
                result,
            );
        if (isGroup) {
            this.conversationEventService.conversationGroupCreated$.next({
                conversationId: res._id.toString(),
                memberIds: normalizedUsers,
            });
            this.statsService.incrementNewGroup();
        } else {
            this.statsService.incrementNewDirect();
        }
        return res;
    }

    /**
     * Chấp nhận conversation đang chờ bằng cách thêm user vào acceptedBy.
     */
    async acceptConversation(conversationId: string, currentUserId: string) {
        const conversation =
            await this.conversationModel.findById(conversationId);
        if (!conversation) {
            throw new NotFoundException(
                CONVERSATION_MESSAGES.CONVERSATION_NOT_FOUND,
            );
        }

        const objectUserId = toObjectId(currentUserId, 'currentUserId');

        if (!conversation.users.some((id) => id.equals(objectUserId))) {
            throw new ForbiddenException(CONVERSATION_MESSAGES.NOT_A_MEMBER);
        }

        if (conversation.acceptedBy.some((id) => id.equals(objectUserId))) {
            return { message: CONVERSATION_MESSAGES.ALREADY_ACCEPTED };
        }

        conversation.acceptedBy.push(objectUserId);
        await conversation.save();

        return { message: CONVERSATION_MESSAGES.ACCEPT_SUCCESS };
    }
}
