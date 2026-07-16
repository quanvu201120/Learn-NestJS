import { Injectable } from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { Subject } from 'rxjs';
import {
    MessageEnumType,
    MessageReactionEnumType,
    MessageResponse,
} from './types/message';
import { MessageLookupService } from './message-lookup.service';
import { MessageQueryService } from './message-query.service';
import { MessageReactionService } from './message-reaction.service';
import { MessagePinService } from './message-pin.service';
import { MessageEventService } from './message-event.service';
import { MessageCommandService } from './message-command.service';

@Injectable()
export class MessagesService {
    public readonly restoredConversation$: Subject<{
        conversationId: string;
        members: string[];
    }>;
    public readonly unseenMessage$: Subject<{
        conversationId: string;
        userIds: string[];
    }>;

    public readonly updatedMessage$: Subject<MessageResponse>;
    public readonly createdMessage$: Subject<MessageResponse>;
    public readonly pinnedMessage$: Subject<{
        conversationId: string;
        messageId: string;
    }>;
    public readonly unpinnedMessage$: Subject<{
        conversationId: string;
        messageId: string;
    }>;

    constructor(
        private readonly messageLookupService: MessageLookupService,
        private readonly messageQueryService: MessageQueryService,
        private readonly messageReactionService: MessageReactionService,
        private readonly messagePinService: MessagePinService,
        private readonly messageEventService: MessageEventService,
        private readonly messageCommandService: MessageCommandService,
    ) {
        this.restoredConversation$ =
            this.messageEventService.restoredConversation$;
        this.unseenMessage$ = this.messageEventService.unseenMessage$;
        this.updatedMessage$ = this.messageEventService.updatedMessage$;
        this.createdMessage$ = this.messageEventService.createdMessage$;
        this.pinnedMessage$ = this.messageEventService.pinnedMessage$;
        this.unpinnedMessage$ = this.messageEventService.unpinnedMessage$;
    }

    /**
     * Lấy chi tiết một tin nhắn theo ID, kèm theo thông tin người gửi và tin nhắn được reply.
     */
    async getMessageById(messageId: string, session?: ClientSession) {
        return this.messageLookupService.getMessageById(messageId, session);
    }

    /**
     * Kiểm tra xem một tin nhắn có tồn tại và thuộc về một cuộc trò chuyện cụ thể hay không.
     */
    async checkMessageExistInConversation(
        messageId: string,
        conversationId: string,
    ) {
        return this.messageLookupService.checkMessageExistInConversation(
            messageId,
            conversationId,
        );
    }

    /**
     * Tạo một tin nhắn mới trong conversation và commit toàn bộ thay đổi theo transaction.
     * Sau khi lưu message thành công, hàm cập nhật `lastMessageId`, mở lại conversation
     * cho các thành viên đang bị ẩn (`hiddenHistory.isHidden = true`), rồi phát sự kiện
     * realtime để những client đó refresh sidebar khi tin nhắn đầu tiên xuất hiện.
     */
    async createMessage(
        senderId: string,
        conversationId: string,
        type: MessageEnumType,
        content?: string,
        replyTo?: string,
        file?: Express.Multer.File,
        externalSession?: ClientSession,
    ) {
        return this.messageCommandService.createMessage(
            senderId,
            conversationId,
            type,
            content,
            replyTo,
            file,
            externalSession,
        );
    }

    async getLatestMessageOfConversation(
        conversationId: string,
        currentUserId?: string,
    ) {
        return this.messageQueryService.getLatestMessageOfConversation(
            conversationId,
            currentUserId,
        );
    }

    /**
     * Lấy danh sách tin nhắn của phòng chat (có phân trang bằng cursor).
     * Bỏ qua các tin nhắn cũ nếu người dùng đã từng Ẩn phòng chat (hiddenHistory).
     */
    async getMessagesByConversation(
        conversationId: string,
        userId: string,
        cursor?: string,
    ) {
        return this.messageQueryService.getMessagesByConversation(
            conversationId,
            userId,
            cursor,
        );
    }

    /**
     * Thu hồi (xóa mềm) tin nhắn của người gửi.
     */
    async softDeleteMessage(
        messageId: string,
        conversationId: string,
        userId: string,
    ) {
        return this.messageCommandService.softDeleteMessage(
            messageId,
            conversationId,
            userId,
        );
    }

    async pinMessage(
        conversationId: string,
        messageId: string,
        userId: string,
    ) {
        const result = await this.messagePinService.pinMessage(
            conversationId,
            messageId,
            userId,
        );

        this.pinnedMessage$.next({
            conversationId,
            messageId,
        });

        return result;
    }

    async unpinMessage(
        conversationId: string,
        messageId: string,
        userId: string,
    ) {
        const result = await this.messagePinService.unpinMessage(
            conversationId,
            messageId,
            userId,
        );

        this.unpinnedMessage$.next({
            conversationId,
            messageId,
        });

        return result;
    }

    /**
     * Xóa vĩnh viễn toàn bộ tin nhắn của một cuộc trò chuyện.
     * Được gọi khi giải tán nhóm.
     */
    async deleteMessagesByConversationId(
        conversationId: string,
        session?: ClientSession,
    ) {
        return this.messageCommandService.deleteMessagesByConversationId(
            conversationId,
            session,
        );
    }

    async updateMessageContent(
        userId: string,
        messageId: string,
        content: string,
        conversationId: string,
    ) {
        return this.messageCommandService.updateMessageContent(
            userId,
            messageId,
            content,
            conversationId,
        );
    }

    async updateOrInsertReaction(
        userId: string,
        messageId: string,
        conversationId: string,
        type: MessageReactionEnumType,
    ) {
        const res = await this.messageReactionService.updateOrInsertReaction(
            userId,
            messageId,
            conversationId,
            type,
        );
        this.updatedMessage$.next(res);
        return res;
    }

    async removeReaction(
        userId: string,
        messageId: string,
        conversationId: string,
    ) {
        const res = await this.messageReactionService.removeReaction(
            userId,
            messageId,
            conversationId,
        );
        this.updatedMessage$.next(res);
        return res;
    }
}
