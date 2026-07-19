import {
    BadRequestException,
    forwardRef,
    Inject,
    Injectable,
} from '@nestjs/common';
import { toObjectId, validateObjectId } from '@/utils/utils';
import { CONVERSATION_MESSAGES } from '../conversations/constants/conversation.constant';
import { ConversationsService } from '../conversations/conversations.service';
import { ConversationDocument } from '../conversations/schemas/conversation.schema';
import { MESSAGE_MESSAGES } from './constants/message.constant';
import { MessageLookupService } from './message-lookup.service';

@Injectable()
export class MessagePinService {
    constructor(
        @Inject(forwardRef(() => ConversationsService))
        private readonly conversationService: ConversationsService,
        private readonly messageLookupService: MessageLookupService,
    ) {}

    private ensureCanPinConversation(
        conversation: ConversationDocument,
        currentUserId: string,
    ) {
        if (conversation.isGroup) {
            this.conversationService.ensureGroupAdmin(
                conversation,
                currentUserId,
            );
        } else {
            this.conversationService.ensureMemberInConversation(
                conversation,
                currentUserId,
            );
        }
    }

    async pinMessage(
        conversationId: string,
        messageId: string,
        userId: string,
    ) {
        const { conversation } =
            await this.conversationService.getConversationOrThrow(
                conversationId,
            );
        validateObjectId(messageId, 'message id');

        this.ensureCanPinConversation(conversation, userId);

        const message =
            await this.messageLookupService.checkMessageExistInConversation(
                messageId,
                conversationId,
            );

        if (message.isDeleted) {
            throw new BadRequestException(MESSAGE_MESSAGES.ALREADY_DELETED);
        }
        if (message.callId) {
            throw new BadRequestException(
                MESSAGE_MESSAGES.CALL_MESSAGE_ACTION_NOT_ALLOWED,
            );
        }

        const pin = await this.conversationService.pinMessage(
            conversationId,
            messageId,
        );

        if (!pin) {
            throw new BadRequestException(
                CONVERSATION_MESSAGES.PIN_MESSAGE_FAILED,
            );
        }

        return { success: true };
    }

    async unpinMessage(
        conversationId: string,
        messageId: string,
        userId: string,
    ) {
        const { conversation } =
            await this.conversationService.getConversationOrThrow(
                conversationId,
            );
        this.ensureCanPinConversation(conversation, userId);

        const objectMessageId = toObjectId(messageId, 'message id');
        if (!conversation.pinMessageId?.equals(objectMessageId)) {
            throw new BadRequestException(
                MESSAGE_MESSAGES.PIN_MESSAGE_NOT_PINNED,
            );
        }

        const unpin =
            await this.conversationService.unpinMessage(conversationId);

        if (!unpin) {
            throw new BadRequestException(
                CONVERSATION_MESSAGES.UNPIN_MESSAGE_FAILED,
            );
        }

        return { success: true };
    }
}
