/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
    CONVERSATION_CONSTANTS,
    CONVERSATION_MESSAGES,
} from './constants/conversation.constant';
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
import { MESSAGE_MESSAGES } from '../messages/constants/message.constant';
import { MessagesService } from '../messages/messages.service';
import { UsersService } from '../users/users.service';
import {
    ConversationResponse,
    UpdateAdminConversationResponse,
    UpdateNameConversationResponse,
} from './types/conversation';
import { RedisService } from '@/redis/redis.service';
import { MediaService } from '../media/media.service';
import { Media } from '../media/schemas/media.schema';
import {
    MEDIA_CONSTANTS,
    MEDIA_MESSAGES,
} from '../media/constants/media.constant';
import { MediaProviderEnum, OwnerTypeEnum } from '../media/types/media';
import { MessageEnumType } from '../messages/types/message';
import {
    CleanupJobEntityEnum,
    CleanupJobResourceEnum,
} from '../cleanup-jobs/types/cleanup-job';
import { GLOBAL_CONSTANTS } from '@/common/constants/global.constant';
import { RelationshipsService } from '../relationships/relationships.service';
import { StatsService } from '../stats/stats.service';
import { ConversationAccessService } from './conversation-access.service';
import { ConversationCommandService } from './conversation-command.service';
import { ConversationEventService } from './conversation-event.service';
import { ConversationGroupAdminService } from './conversation-group-admin.service';
import { ConversationMediaService } from './conversation-media.service';
import { ConversationMemberService } from './conversation-member.service';
import { ConversationQueryService } from './conversation-query.service';
import { ConversationSerializerService } from './conversation-serializer.service';
import { ConversationStateService } from './conversation-state.service';

@Injectable()
export class ConversationsService {
    public readonly conversationDisbanded$: ConversationEventService['conversationDisbanded$'];
    public readonly conversationGroupCreated$: ConversationEventService['conversationGroupCreated$'];
    public readonly memberAdded$: ConversationEventService['memberAdded$'];
    public readonly memberRemoved$: ConversationEventService['memberRemoved$'];
    public readonly conversationNameChanged$: ConversationEventService['conversationNameChanged$'];
    public readonly conversationAdminChanged$: ConversationEventService['conversationAdminChanged$'];

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

        private readonly conversationAccessService: ConversationAccessService,

        private readonly conversationCommandService: ConversationCommandService,

        private readonly conversationEventService: ConversationEventService,

        private readonly conversationGroupAdminService: ConversationGroupAdminService,

        private readonly conversationMediaService: ConversationMediaService,

        private readonly conversationMemberService: ConversationMemberService,

        private readonly conversationQueryService: ConversationQueryService,

        private readonly conversationSerializerService: ConversationSerializerService,

        private readonly conversationStateService: ConversationStateService,
    ) {
        this.conversationDisbanded$ =
            this.conversationEventService.conversationDisbanded$;
        this.conversationGroupCreated$ =
            this.conversationEventService.conversationGroupCreated$;
        this.memberAdded$ = this.conversationEventService.memberAdded$;
        this.memberRemoved$ = this.conversationEventService.memberRemoved$;
        this.conversationNameChanged$ =
            this.conversationEventService.conversationNameChanged$;
        this.conversationAdminChanged$ =
            this.conversationEventService.conversationAdminChanged$;
    }

    /**
     * Helper nội bộ: Format dữ liệu conversation trước khi trả về client.
     * Chuyển đổi ID của lastMessage thành object nếu đã được populate.
     */
    private async serializeConversation(
        conversation: any,
        currentUserId?: string,
        preloadedHiddenUserIds?: string[],
        checkHiddenUserBlock = false,
    ): Promise<ConversationResponse> {
        return this.conversationSerializerService.serializeConversation(
            conversation,
            currentUserId,
            preloadedHiddenUserIds,
            checkHiddenUserBlock,
        );
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
        return this.conversationCommandService.createConversation(
            createConversationDto,
            currentUserId,
        );
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
        return this.conversationQueryService.findAllByUser(
            userId,
            cursor,
            limit,
        );
    }

    /**
     * Lấy chi tiết một phòng chat theo ID (dành cho user hiện tại).
     */
    async findOne(conversationId: string, userId: string) {
        return this.conversationQueryService.findOne(conversationId, userId);
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
        return this.conversationStateService.updateLastMessageAndRestoreConversation(
            id,
            messageId,
            userId,
            session,
        );
    }

    async pinMessage(
        conversationId: string,
        messageId: string,
        session?: ClientSession,
    ) {
        return this.conversationStateService.pinMessage(
            conversationId,
            messageId,
            session,
        );
    }

    async unpinMessage(conversationId: string, session?: ClientSession) {
        return this.conversationStateService.unpinMessage(
            conversationId,
            session,
        );
    }

    /**
     * Đổi tên Group Chat (chỉ dành cho Admin của Group).
     */
    async updateNameConversation(
        id: string,
        currentUserId: string,
        name: string,
    ) {
        return this.conversationStateService.updateNameConversation(
            id,
            currentUserId,
            name,
        );
    }

    /**
     * Thêm thành viên mới vào group chat.
     * Chỉ admin được phép thực hiện; member mới được thêm vào danh sách `users`,
     * được tạo record `hiddenHistory` mặc định không ẩn, sau đó hệ thống gửi
     * system message và phát sự kiện realtime để client cập nhật sidebar/phòng chat.
     */
    async addMembers(id: string, currentUserId: string, memberIds: string[]) {
        return this.conversationMemberService.addMembers(
            id,
            currentUserId,
            memberIds,
        );
    }

    /**
     * Xóa một thành viên khỏi group chat hoặc để chính thành viên tự rời nhóm.
     * Hàm đồng thời dọn `hiddenHistory`, `readReceipts`, xóa cờ unseen của người bị remove,
     * gửi system message tương ứng và phát sự kiện realtime để các client cập nhật trạng thái.
     */
    async removeMember(id: string, currentUserId: string, memberId: string) {
        return this.conversationMemberService.removeMember(
            id,
            currentUserId,
            memberId,
        );
    }

    /**
     * Giải tán group chat.
     * Xóa conversation và toàn bộ message trong transaction; sau khi commit thành công
     * thì dọn cờ unseen còn sót trong Redis và phát sự kiện realtime để các thành viên
     * xóa group khỏi sidebar ngay lập tức.
     */
    async disbandGroup(id: string, currentUserId: string) {
        return this.conversationGroupAdminService.disbandGroup(
            id,
            currentUserId,
        );
    }

    /**
     * Thay đổi trưởng nhóm (chỉ dành cho Admin của Group).
     */
    async changeAdminGroup(
        currentUserId: string,
        newAdminId: string,
        conversationId: string,
    ) {
        return this.conversationGroupAdminService.changeAdminGroup(
            currentUserId,
            newAdminId,
            conversationId,
        );
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
        return this.conversationStateService.hiddenHistory(
            conversationId,
            userId,
            session,
        );
    }

    /**
     * Xóa tin nhắn chờ và block user gửi tin nhắn đó.
     */
    async blockAndDelete(conversationId: string, userId: string) {
        return this.conversationStateService.blockAndDelete(
            conversationId,
            userId,
        );
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
        return this.conversationStateService.markAsRead(
            conversationId,
            userId,
            messageId,
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
        return this.conversationMediaService.uploadAvatar(
            conversationId,
            userId,
            file,
        );
    }

    /**
     * Xóa ảnh nhóm chat
     */
    async deleteAvatar(conversationId: string, userId: string) {
        return this.conversationMediaService.deleteAvatar(
            conversationId,
            userId,
        );
    }

    /**
     * Lấy mảng tất cả các Conversation ID mà user đang tham gia (Dùng để khởi tạo Socket Join).
     */
    async getAllConversationIdsByUser(userId: string): Promise<string[]> {
        return this.conversationQueryService.getAllConversationIdsByUser(
            userId,
        );
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
        return this.conversationAccessService.getConversationOrThrow(
            conversationId,
        );
    }

    /**
     * Helper: Kiểm tra xem conversation có phải là nhóm hay không.
     */
    ensureGroupConversation(conversation: ConversationDocument) {
        return this.conversationAccessService.ensureGroupConversation(
            conversation,
        );
    }

    /**
     * Helper: Kiểm tra xem đoạn chat 1-1 có hợp lệ (người nhận không bị vô hiệu hóa) hay không.
     */
    async ensureDirectChatActive(
        conversation: ConversationDocument,
        currentUserId: string,
    ) {
        return this.conversationAccessService.ensureDirectChatActive(
            conversation,
            currentUserId,
        );
    }

    /**
     * Helper: Kiểm tra user có phải là admin của group chat hay không.
     */
    ensureGroupAdmin(
        conversation: ConversationDocument,
        currentUserId: string,
    ) {
        return this.conversationAccessService.ensureGroupAdmin(
            conversation,
            currentUserId,
        );
    }

    /**
     * Helper: Đảm bảo một user ID đang là thành viên của cuộc trò chuyện.
     */
    ensureMemberInConversation(
        conversation: ConversationDocument,
        memberId: string,
    ) {
        return this.conversationAccessService.ensureMemberInConversation(
            conversation,
            memberId,
        );
    }

    /**
     * Helper: Kiểm tra user đã chấp nhận cuộc trò chuyện hay chưa.
     */
    ensureMemberAcceptedConversation(
        conversation: ConversationDocument,
        memberId: string,
    ) {
        return this.conversationAccessService.ensureMemberAcceptedConversation(
            conversation,
            memberId,
        );
    }

    /**
     * Helper: Kiểm tra xem MongoDB ObjectId hiện tại có lớn hơn (tức là được sinh ra sau) ObjectId kia không.
     * Dùng để check logic xem tin nhắn nào cũ hơn/mới hơn dựa vào ID sinh theo timestamp.
     */
    isObjectIdAfter(currentId: Types.ObjectId, nextId: Types.ObjectId) {
        return this.conversationAccessService.isObjectIdAfter(
            currentId,
            nextId,
        );
    }
    /**
     * Chấp nhận tin nhắn chờ (Thêm user vào acceptedBy)
     */
    async acceptConversation(conversationId: string, currentUserId: string) {
        return this.conversationCommandService.acceptConversation(
            conversationId,
            currentUserId,
        );
    }
}
