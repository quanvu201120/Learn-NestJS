import { AUTH_MESSAGES } from '@/auth/constants/auth.constant';
import { formatDateTime, toObjectId } from '@/utils/utils';
import {
    BadRequestException,
    Inject,
    Injectable,
    forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UsersService } from '../users/users.service';
import { CONVERSATION_MESSAGES } from './constants/conversation.constant';
import {
    Conversation,
    ConversationDocument,
} from './schemas/conversation.schema';

@Injectable()
export class ConversationAccessService {
    constructor(
        @InjectModel(Conversation.name)
        private readonly conversationModel: Model<ConversationDocument>,

        @Inject(forwardRef(() => UsersService))
        private readonly userService: UsersService,
    ) {}

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
                        CONVERSATION_MESSAGES.USER_DISABLED,
                    );
                }
                if (
                    otherUser &&
                    otherUser.banUntil &&
                    otherUser.banUntil > new Date()
                ) {
                    const time = formatDateTime(otherUser.banUntil);
                    throw new BadRequestException(
                        AUTH_MESSAGES.ACCOUNT_BANNED_UNTIL(time),
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
}
