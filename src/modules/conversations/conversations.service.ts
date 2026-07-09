/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

/* eslint-disable @typescript-eslint/no-unused-vars */
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
    InternalServerErrorException,
    NotFoundException,
    ForbiddenException,
} from '@nestjs/common';
import { toObjectId } from '@/utils/utils';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Model, Types, Connection } from 'mongoose';
import {
    Conversation,
    ConversationDocument,
} from './schemas/conversation.schema';
import { serializeMessage } from '../messages/utils/message.serializer';
import { MessagesService } from '../messages/messages.service';
import { UsersService } from '../users/users.service';
import {
    ConversationResponse,
    ListConversationResponse,
    UpdateAdminConversationResponse,
    UpdateNameConversationResponse,
} from './types/conversation';
import { RedisService } from '@/redis/redis.service';
import { Subject } from 'rxjs';
import { MediaService } from '../media/media.service';
import { Media } from '../media/schemas/media.schema';
import {
    MEDIA_CONSTANTS,
    MEDIA_MESSAGES,
} from '../media/constants/media.constant';
import { MediaProviderEnum, OwnerTypeEnum } from '../media/types/media';
import { MessageEnumType } from '../messages/types/message';
import { serializeMedia } from '../media/utils/media.serializer';
import {
    CleanupJobEntityEnum,
    CleanupJobResourceEnum,
} from '../cleanup-jobs/types/cleanup-job';
import { RelationshipsService } from '../relationships/relationships.service';
import { GLOBAL_CONSTANTS } from '@/common/constants/global.constant';
import { StatsService } from '../stats/stats.service';

@Injectable()
export class ConversationsService {
    public readonly conversationDisbanded$ = new Subject<{
        conversationId: string;
        memberIds: string[];
    }>();
    public readonly conversationGroupCreated$ = new Subject<{
        conversationId: string;
        memberIds: string[];
    }>();

    public readonly memberAdded$ = new Subject<{
        conversationId: string;
        addedMemberIds: string[];
        adderId: string;
    }>();

    public readonly memberRemoved$ = new Subject<{
        conversationId: string;
        removedMemberId: string;
        removerId: string;
    }>();

    public readonly conversationNameChanged$ = new Subject<{
        conversationId: string;
        name: string;
    }>();

    public readonly conversationAdminChanged$ = new Subject<{
        conversationId: string;
        newAdminId: string;
        membersOnline: string[];
    }>();

    constructor(
        @InjectModel(Conversation.name)
        private readonly conversationModel: Model<ConversationDocument>,

        @Inject(forwardRef(() => MessagesService))
        private readonly messageService: MessagesService,

        @Inject(forwardRef(() => UsersService))
        private readonly userService: UsersService,

        @InjectConnection()
        private readonly connection: Connection,

        @Inject(forwardRef(() => RedisService))
        private readonly redisService: RedisService,

        @Inject(forwardRef(() => MediaService))
        private readonly mediaService: MediaService,

        @Inject(forwardRef(() => RelationshipsService))
        private readonly relationshipsService: RelationshipsService,

        private readonly statsService: StatsService,
    ) {}

    /**
     * Helper nội bộ: Format dữ liệu conversation trước khi trả về client.
     * Chuyển đổi ID của lastMessage thành object nếu đã được populate.
     */
    private serializeConversation(conversation: any): ConversationResponse {
        const { lastMessageId, avatar, users, ...rest } = conversation;

        let processedUsers = users;
        if (conversation.isGroup) {
            processedUsers = users?.filter((user: any) => !user.isDisabled);
        }

        return {
            ...rest,
            users: processedUsers?.map((user: any) => {
                let mappedUser = user;
                if (!conversation.isGroup && user && user.isDisabled) {
                    mappedUser = {
                        ...(user.toJSON ? user.toJSON() : user),
                        name: CONVERSATION_MESSAGES.DISABLED_ACCOUNT_NAME,
                        avatar: undefined,
                        isDisabled: true, // <-- IMPORTANT FOR FRONTEND
                    };
                }

                if (
                    mappedUser &&
                    typeof mappedUser === 'object' &&
                    '_id' in mappedUser &&
                    mappedUser.avatar &&
                    typeof mappedUser.avatar === 'object' &&
                    '_id' in mappedUser.avatar
                ) {
                    return {
                        ...mappedUser,
                        avatar: serializeMedia(mappedUser.avatar),
                    };
                }
                return mappedUser;
            }),
            avatar: avatar ? serializeMedia(avatar) : avatar,
            lastMessage: lastMessageId
                ? typeof lastMessageId === 'object' && '_id' in lastMessageId
                    ? serializeMessage(lastMessageId)
                    : lastMessageId
                : undefined,
        };
    }

    /**
     * Tạo một conversation mới hoặc khôi phục conversation 1-1 đã tồn tại.
     * - Chat 1-1: nếu đã có sẵn thì trả lại conversation cũ; nếu người tạo từng ẩn nó thì mở lại `hiddenHistory`.
     * - Group chat: tạo conversation mới, gán admin là người tạo và phát sự kiện realtime để các thành viên refresh sidebar.
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
                .populate({
                    path: 'users',
                    select: '-password -__v',
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
                        .populate({
                            path: 'users',
                            select: '-password -__v',
                            populate: { path: 'avatar', select: '-__v' },
                        })
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
        // Tính toán danh sách acceptedBy (Tin nhắn chờ)
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

        // 2. Nếu là group chat hoặc phòng 1-1 chưa tồn tại -> Tiến hành tạo mới
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
        const res = this.serializeConversation(result);
        if (isGroup) {
            this.conversationGroupCreated$.next({
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
                select: '-password -__v',
                populate: { path: 'avatar', select: '-__v' },
            })
            .populate('lastMessageId', '-__v')
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

        const res: ListConversationResponse = {
            nextCursor,
            conversations: conversations.map((conversation) =>
                this.serializeConversation(conversation as any),
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
                select: '-password -__v',
                populate: { path: 'avatar', select: '-__v' },
            })
            .populate('lastMessageId', '-__v')
            .populate('avatar', '-__v')
            .lean();
        return res ? this.serializeConversation(res) : null;
    }

    /**
     * Cập nhật tin nhắn cuối cùng (lastMessageId) cho phòng chat.
     * Đồng thời bỏ ẩn (restore) phòng chat này nếu trước đó có user nào lỡ ẩn nó đi.
     * Đồng thời đánh dấu người gửi đã đọc tin nhắn này.
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
            { new: true, arrayFilters: [{ 'item.isHidden': true }], session },
        );
        return result;
    }

    /**
     * Đổi tên Group Chat (chỉ dành cho Admin của Group).
     */
    async updateNameConversation(
        id: string,
        currentUserId: string,
        name: string,
    ) {
        const { conversation, objectConversationId } =
            await this.getConversationOrThrow(id);

        this.ensureGroupConversation(conversation);
        this.ensureGroupAdmin(conversation, currentUserId);
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
                { new: true },
            )
            .lean();
        const res: UpdateNameConversationResponse = {
            updated: !!result,
        };
        if (result) {
            this.conversationNameChanged$.next({
                conversationId: id,
                name: result.name!,
            });
        }
        return res;
    }

    /**
     * Thêm thành viên mới vào group chat.
     * Chỉ admin được phép thực hiện; member mới được thêm vào danh sách `users`,
     * được tạo record `hiddenHistory` mặc định không ẩn, sau đó hệ thống gửi
     * system message và phát sự kiện realtime để client cập nhật sidebar/phòng chat.
     */
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
                    $push: {
                        hiddenHistory: {
                            $each: objectMemberIds.map((memberId) => ({
                                userId: memberId,
                                isHidden: false,
                                hiddenAt: new Date(),
                            })),
                        },
                    },
                },
                { new: true },
            )
            .select('-__v')
            .populate({
                path: 'users',
                select: '-password -__v',
                populate: { path: 'avatar', select: '-__v' },
            })
            .populate('lastMessageId', '-__v')
            .populate('avatar', '-__v')
            .lean();

        if (result) {
            const addedUsers = result.users as any[];
            const addedNames = addedUsers
                .filter((u) => memberIds.includes(u._id.toString()))
                .map((u) => u.name || u.email)
                .join(', ');

            await this.messageService.createMessage(
                currentUserId,
                id,
                MessageEnumType.SYSTEM,
                CONVERSATION_MESSAGES.SYSTEM_ADDED_MEMBERS(addedNames),
            );

            this.memberAdded$.next({
                conversationId: id,
                addedMemberIds: memberIds,
                adderId: currentUserId,
            });
            return this.serializeConversation(result);
        }
        return null;
    }

    /**
     * Xóa một thành viên khỏi group chat hoặc để chính thành viên tự rời nhóm.
     * Hàm đồng thời dọn `hiddenHistory`, `readReceipts`, xóa cờ unseen của người bị remove,
     * gửi system message tương ứng và phát sự kiện realtime để các client cập nhật trạng thái.
     */
    async removeMember(id: string, currentUserId: string, memberId: string) {
        const { conversation, objectConversationId } =
            await this.getConversationOrThrow(id);

        this.ensureGroupConversation(conversation);
        if (currentUserId !== memberId) {
            this.ensureGroupAdmin(conversation, currentUserId);
        }

        if (
            currentUserId === memberId &&
            currentUserId === conversation.adminGroupId?.toString()
        ) {
            throw new BadRequestException(
                CONVERSATION_MESSAGES.CANNOT_REMOVE_ADMIN,
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
                        acceptedBy: objectMemberId,
                    },
                    $unset: {
                        [`readReceipts.${memberId}`]: 1,
                    },
                },
                { new: true },
            )
            .select('-__v')
            .populate({
                path: 'users',
                select: '-password -__v',
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
        const removedUser = await this.userService.findOneForApi(memberId);
        const removedName = removedUser?.name || removedUser?.email || memberId;

        const messageContent =
            currentUserId === memberId
                ? CONVERSATION_MESSAGES.SYSTEM_LEFT_GROUP(removedName)
                : CONVERSATION_MESSAGES.SYSTEM_REMOVED_FROM_GROUP(removedName);

        await this.messageService.createMessage(
            currentUserId,
            id,
            MessageEnumType.SYSTEM,
            messageContent,
        );

        await this.redisService.removeUnseenConversationWithCleanup(
            memberId,
            id,
        );

        this.memberRemoved$.next({
            conversationId: id,
            removedMemberId: memberId,
            removerId: currentUserId,
        });

        return { remove: result ? true : false };
    }

    /**
     * Giải tán group chat.
     * Xóa conversation và toàn bộ message trong transaction; sau khi commit thành công
     * thì dọn cờ unseen còn sót trong Redis và phát sự kiện realtime để các thành viên
     * xóa group khỏi sidebar ngay lập tức.
     */
    async disbandGroup(id: string, currentUserId: string) {
        const { conversation, objectConversationId } =
            await this.getConversationOrThrow(id);

        this.ensureGroupConversation(conversation);
        this.ensureGroupAdmin(conversation, currentUserId);

        const session = await this.connection.startSession();

        const mediaList = {
            publicIds: [] as string[],
            objectKeys: [] as string[],
        };

        try {
            await session.withTransaction(async () => {
                const getMedia =
                    await this.mediaService.getMediaCleanupKeysByConversation(
                        conversation._id.toString(),
                        session,
                    );
                mediaList.publicIds = getMedia.listPublicId;
                mediaList.objectKeys = getMedia.listObjectKey;

                // Xóa toàn bộ tin nhắn thuộc conversation trong database
                await this.messageService.deleteMessagesByConversationId(
                    id,
                    session,
                );

                // Xóa toàn bộ media thuộc conversation trong database
                await this.mediaService.deleteAllMediaByConversation(
                    id,
                    session,
                );

                // Sau đó xóa nhóm
                await this.conversationModel.findByIdAndDelete(
                    objectConversationId,
                    { session },
                );
            });
        } catch (error) {
            throw new InternalServerErrorException(
                CONVERSATION_MESSAGES.DELETE_FAILED,
            );
        } finally {
            await session.endSession();
        }

        //Kiểm tra và xóa unseen conversation trong redis, không throw lỗi
        await this.redisService
            .removeAllUnseenConversationWithCleanup(conversation.users, id)
            .catch((error) => {
                console.error('Remove all unseen conversation failed', error);
            });

        // Xóa toàn bộ media thuộc conversation trong r2
        if (mediaList.objectKeys && mediaList.objectKeys.length > 0) {
            await this.mediaService.deleteFilesFromR2WithCleanup(
                mediaList.objectKeys,
                {
                    entityType: CleanupJobEntityEnum.CONVERSATION,
                    entityId: conversation._id.toString(),
                    resourceType: CleanupJobResourceEnum.CONVERSATION_MEDIA,
                },
            );
        }
        // Xóa toàn bộ media thuộc conversation trong cloudinary
        if (mediaList.publicIds && mediaList.publicIds.length > 0) {
            await this.mediaService.deleteImagesFromCloudinaryWithCleanup(
                mediaList.publicIds,
                {
                    entityType: CleanupJobEntityEnum.CONVERSATION,
                    entityId: conversation._id.toString(),
                    resourceType: CleanupJobResourceEnum.CONVERSATION_MEDIA,
                },
            );
        }

        this.conversationDisbanded$.next({
            conversationId: id,
            memberIds: conversation.users.map((user) => user.toString()),
        });

        return { message: CONVERSATION_MESSAGES.DELETE_SUCCESS };
    }

    /**
     * Thay đổi trưởng nhóm (chỉ dành cho Admin của Group).
     */
    async changeAdminGroup(
        currentUserId: string,
        newAdminId: string,
        conversationId: string,
    ) {
        const { conversation, objectConversationId } =
            await this.getConversationOrThrow(conversationId);

        this.ensureGroupConversation(conversation);
        this.ensureGroupAdmin(conversation, currentUserId);
        this.ensureMemberInConversation(conversation, newAdminId);
        this.ensureMemberAcceptedConversation(conversation, newAdminId);

        if (currentUserId === newAdminId) {
            throw new BadRequestException(
                CONVERSATION_MESSAGES.CURRENT_USER_IS_ALREADY_ADMIN,
            );
        }

        const objectNewAdminId = toObjectId(newAdminId, 'new admin id');

        const session = await this.connection.startSession();
        let result: any = null;
        try {
            await session.withTransaction(async () => {
                result = await this.conversationModel
                    .findByIdAndUpdate(
                        objectConversationId,
                        { $set: { adminGroupId: objectNewAdminId } },
                        { new: true, session },
                    )
                    .populate('users', 'name email')
                    .lean();

                if (!result) {
                    throw new BadRequestException(
                        CONVERSATION_MESSAGES.CONVERSATION_NOT_FOUND,
                    );
                }

                const currentUserObj = result.users.find(
                    (u: any) => u._id.toString() === currentUserId,
                );
                const newAdminObj = result.users.find(
                    (u: any) => u._id.toString() === newAdminId,
                );
                const currentName =
                    (currentUserObj as any)?.name ||
                    CONVERSATION_MESSAGES.ADMIN_LABEL;
                const newName =
                    (newAdminObj as any)?.name ||
                    CONVERSATION_MESSAGES.MEMBER_LABEL;

                await this.messageService.createMessage(
                    currentUserId,
                    conversationId,
                    MessageEnumType.SYSTEM,
                    CONVERSATION_MESSAGES.SYSTEM_TRANSFER_ADMIN(
                        currentName,
                        newName,
                    ),
                    undefined,
                    undefined,
                    session,
                );
            });
        } finally {
            await session.endSession();
        }

        const userIds = result.users.map((u: any) => u._id.toString());
        const membersOnline =
            await this.redisService.getUserOnlineInListIds(userIds);
        if (membersOnline.length > 0) {
            this.conversationAdminChanged$.next({
                conversationId,
                newAdminId,
                membersOnline: membersOnline.map((userId) => userId.toString()),
            });
        }
        const res: UpdateAdminConversationResponse = {
            updated: true,
        };
        return res;
    }

    /**
     * Ẩn phòng chat khỏi danh sách của một user.
     * Phòng chat sẽ bị ẩn cho tới khi có tin nhắn mới tới, nó sẽ được restore.
     * Xóa cờ unseen
     */
    async hiddenHistory(
        conversationId: string,
        userId: string,
        session?: ClientSession,
    ) {
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
        // Check if we need to remove from acceptedBy
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
                    { new: true, session },
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
                    { new: true, session },
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
     * Xóa tin nhắn chờ và block user gửi tin nhắn đó.
     */
    async blockAndDelete(conversationId: string, userId: string) {
        const objectUserId = toObjectId(userId, 'user id');
        const session = await this.connection.startSession();
        try {
            await session.withTransaction(async () => {
                const { conversation } =
                    await this.getConversationOrThrow(conversationId);
                this.ensureMemberInConversation(conversation, userId);
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
     * Đánh dấu người dùng đã đọc đến một tin nhắn cụ thể trong phòng chat.
     * Lưu vào thuộc tính `readReceipts`.
     */
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

    /**
     * Cập nhật ảnh nhóm chat
     */
    async uploadAvatar(
        conversationId: string,
        userId: string,
        file: Express.Multer.File,
    ) {
        const { conversation, objectConversationId } =
            await this.getConversationOrThrow(conversationId);
        this.ensureGroupConversation(conversation);
        const objectUserId = this.ensureGroupAdmin(conversation, userId);
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
                            { new: true, session },
                        )
                        .select('-__v')
                        .populate({
                            path: 'users',
                            select: '-password -__v',
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
            return this.serializeConversation(conversationUpdated);
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
     * Xóa ảnh nhóm chat
     */
    async deleteAvatar(conversationId: string, userId: string) {
        const { conversation, objectConversationId } =
            await this.getConversationOrThrow(conversationId);
        this.ensureGroupConversation(conversation);
        this.ensureGroupAdmin(conversation, userId);
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
                            { new: true, session },
                        )
                        .select('-__v')
                        .populate({
                            path: 'users',
                            select: '-password -__v',
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
            return this.serializeConversation(conversationUpdated);
        } finally {
            await session.endSession();
        }
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

    /**
     * Kiểm tra tin nhắn có thuộc về cuộc trò chuyện này hay không, nếu không ném lỗi.
     */
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

    /**
     * Helper: Tìm Conversation, nếu không tồn tại thì ném lỗi.
     */
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

    /**
     * Helper: Kiểm tra xem conversation có phải là nhóm hay không.
     */
    ensureGroupConversation(conversation: ConversationDocument) {
        if (!conversation.isGroup) {
            throw new BadRequestException(CONVERSATION_MESSAGES.NOT_A_GROUP);
        }
    }

    /**
     * Helper: Kiểm tra xem đoạn chat 1-1 có hợp lệ (người nhận không bị vô hiệu hóa) hay không.
     */
    async ensureDirectChatActive(
        conversation: ConversationDocument,
        currentUserId: string,
    ) {
        if (!conversation.isGroup) {
            const otherUserId = conversation.users.find(
                (id) => id.toString() !== currentUserId,
            );
            if (otherUserId) {
                const otherUser = await this.userService.findOne(
                    otherUserId.toString(),
                );
                if (otherUser && otherUser.isDisabled) {
                    throw new BadRequestException(
                        'Người dùng này đã bị vô hiệu hóa, không thể tiếp tục trò chuyện',
                    );
                }
            }
        }
    }

    /**
     * Helper: Kiểm tra user có phải là admin của group chat hay không.
     */
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

    /**
     * Helper: Đảm bảo một user ID đang là thành viên của cuộc trò chuyện.
     */
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

    /**
     * Helper: Kiểm tra user đã chấp nhận cuộc trò chuyện hay chưa.
     */
    ensureMemberAcceptedConversation(
        conversation: ConversationDocument,
        memberId: string,
    ) {
        const objectMemberId = toObjectId(memberId, 'member id');
        const isAccept = conversation.acceptedBy.some((member) =>
            member.equals(objectMemberId),
        );

        if (!isAccept) {
            throw new BadRequestException(
                CONVERSATION_MESSAGES.USER_NOT_ACCEPTED_CONVERSATION,
            );
        }
    }

    /**
     * Helper: Kiểm tra xem MongoDB ObjectId hiện tại có lớn hơn (tức là được sinh ra sau) ObjectId kia không.
     * Dùng để check logic xem tin nhắn nào cũ hơn/mới hơn dựa vào ID sinh theo timestamp.
     */
    isObjectIdAfter(currentId: Types.ObjectId, nextId: Types.ObjectId) {
        if (currentId.equals(nextId)) {
            return false;
        }

        return currentId.toString() > nextId.toString();
    }
    /**
     * Chấp nhận tin nhắn chờ (Thêm user vào acceptedBy)
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
