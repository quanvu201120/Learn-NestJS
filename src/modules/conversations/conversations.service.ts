/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable prettier/prettier */
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
import { ConversationResponse } from './types/conversation';
import { RedisService } from '@/redis/redis.service';
import { Subject } from 'rxjs';
import { MessageEnumType } from '../messages/schemas/message.schema';

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
    ) {}

    /**
     * Helper nội bộ: Format dữ liệu conversation trước khi trả về client.
     * Chuyển đổi ID của lastMessage thành object nếu đã được populate.
     */
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
        const res = this.serializeConversation(result);
        if (isGroup) {
            this.conversationGroupCreated$.next({
                conversationId: res._id.toString(),
                memberIds: normalizedUsers,
            });
        }
        return res;
    }

    /**
     * Lấy toàn bộ danh sách phòng chat mà user hiện tại tham gia,
     * bỏ qua các phòng chat đã bị user ẩn đi (hiddenHistory).
     */
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
            .populate('users', '-password -__v')
            .populate('lastMessageId', '-__v')
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
            .populate('users', '-password -__v')
            .populate('lastMessageId', '-__v')
            .lean();

        if (result) {
            const addedUsers = result.users as any[];
            const addedNames = addedUsers
                .filter((u) => memberIds.includes(u._id.toString()))
                .map((u) => u.name || u.email || 'Một thành viên')
                .join(', ');

            await this.messageService.createMessage(
                currentUserId,
                id,
                MessageEnumType.SYSTEM,
                `Đã thêm ${addedNames} vào nhóm`,
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

        if (!result) {
            throw new BadRequestException(
                CONVERSATION_MESSAGES.CONVERSATION_NOT_FOUND,
            );
        }
        const removedUser = await this.userService.findOneForApi(memberId);
        const removedName = removedUser
            ? removedUser.name || removedUser.email || 'Một thành viên'
            : 'Một thành viên';

        const messageContent =
            currentUserId === memberId
                ? `${removedName} đã rời khỏi nhóm`
                : `Đã xóa ${removedName} khỏi nhóm`;

        await this.messageService.createMessage(
            currentUserId,
            id,
            MessageEnumType.SYSTEM,
            messageContent,
        );

        await this.redisService.removeUnseenConversation(memberId, id);

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

        try {
            await session.withTransaction(async () => {
                // Xóa toàn bộ tin nhắn của nhóm trước
                await this.messageService.deleteMessagesByConversationId(
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
        try {
            const removeAllUnseenConversation =
                await this.redisService.removeAllUnseenConversation(
                    conversation.users,
                    id,
                );

            if (removeAllUnseenConversation.ok === false) {
                console.error(
                    'Remove all unseen conversation failed',
                    removeAllUnseenConversation,
                );
            }
        } catch (error) {
            console.error('Remove all unseen conversation failed', error);
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

        const objectNewAdminId = toObjectId(newAdminId, 'new admin id');

        const result = await this.conversationModel
            .findByIdAndUpdate(
                objectConversationId,
                { $set: { adminGroupId: objectNewAdminId } },
                { new: true },
            )
            .select('-__v')
            .populate('users', '-password -__v')
            .populate('lastMessageId', '-__v')
            .lean();

        return this.serializeConversation(result);
    }

    /**
     * Ẩn phòng chat khỏi danh sách của một user.
     * Phòng chat sẽ bị ẩn cho tới khi có tin nhắn mới tới, nó sẽ được restore.
     */
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
            throw new BadRequestException(
                CONVERSATION_MESSAGES.DIRECT_ACTION_NOT_ALLOWED,
            );
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
     * Helper: Kiểm tra xem MongoDB ObjectId hiện tại có lớn hơn (tức là được sinh ra sau) ObjectId kia không.
     * Dùng để check logic xem tin nhắn nào cũ hơn/mới hơn dựa vào ID sinh theo timestamp.
     */
    isObjectIdAfter(currentId: Types.ObjectId, nextId: Types.ObjectId) {
        if (currentId.equals(nextId)) {
            return false;
        }

        return currentId.toString() > nextId.toString();
    }
}
