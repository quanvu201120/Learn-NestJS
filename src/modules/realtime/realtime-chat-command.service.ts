import { RedisService } from '@/redis/redis.service';
import { getRoomNameConversation, getRoomNameUser } from '@/utils/utils';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ConversationsService } from '../conversations/conversations.service';
import { CreateMessageSocketDto } from '../messages/dto/create-message.dto';
import { MessagesService } from '../messages/messages.service';
import { MessageEnumType } from '../messages/types/message';
import { RelationshipsService } from '../relationships/relationships.service';
import {
    REALTIME_MESSAGES,
    SOCKET_EVENT_RATE_LIMIT,
    SOCKET_EVENTS,
} from './constants/realtime.constant';
import {
    MarkReadSocketDto,
    TypingSocketDto,
    UpdateMessageSocketDto,
} from './dto/chat-socket.dto';
import { RealtimeAuthService } from './realtime-auth.service';
import {
    CreateMessageResult,
    HeartbeatResult,
    JoinConversationResult,
    MarkReadEventPayload,
    MarkReadResult,
    SocketResponse,
    SoftDeleteMessagePayload,
    SoftDeleteMessageResult,
    TypingEventPayload,
    TypingResult,
    UpdateMessageResult,
} from './types/responseSocket';

@Injectable()
export class RealtimeChatCommandService {
    constructor(
        private readonly realtimeAuthService: RealtimeAuthService,
        private readonly messageService: MessagesService,
        private readonly conversationService: ConversationsService,
        private readonly redisService: RedisService,
        private readonly relationshipsService: RelationshipsService,
    ) {}

    private getRateLimitEventSocketKeyRedis(userId: string, event: string) {
        return `socket:rate-limit:${event}:${userId}`;
    }

    /**
     * Trả về danh sách room cá nhân của những thành viên đang chặn `actorId`,
     * dùng để loại họ khỏi broadcast bằng `.except()`.
     */
    private async getBlockedUserRooms(
        conversation: { users: { toString(): string }[] },
        actorId: string,
    ): Promise<string[]> {
        const blockedUserIds =
            await this.relationshipsService.getBlockedUserIdsAmongUsers(
                actorId,
                conversation.users.map((user) => user.toString()),
            );
        return blockedUserIds.map((userId) => getRoomNameUser(userId));
    }

    /**
     * Kiểm tra rate limit theo sự kiện cho một user,
     * dùng chung Redis sliding window (incrWithTTL).
     */
    private async getEventRateLimitState(
        userId: string,
        event: string,
        { limit, windowSeconds }: { limit: number; windowSeconds: number },
    ) {
        const key = this.getRateLimitEventSocketKeyRedis(userId, event);
        const count = await this.redisService.incrWithTTL(key, windowSeconds);
        if (count <= limit) {
            return { limited: false as const };
        }
        const ttl = await this.redisService.ttl(key);
        return { limited: true as const, retryAfterSeconds: Math.max(ttl, 1) };
    }

    async joinConversation(
        client: Socket,
        body: { conversationId: string },
    ): Promise<SocketResponse<JoinConversationResult>> {
        const payload =
            await this.realtimeAuthService.validateActiveSession(client);

        const rateLimitState = await this.getEventRateLimitState(
            payload._id,
            'chat:join-conversation',
            SOCKET_EVENT_RATE_LIMIT.JOIN_CONVERSATION,
        );
        if (rateLimitState.limited) {
            throw new BadRequestException({
                message: REALTIME_MESSAGES.EVENT_RATE_LIMITED(
                    rateLimitState.retryAfterSeconds,
                ),
                retryAfterSeconds: rateLimitState.retryAfterSeconds,
            });
        }

        const { conversation } =
            await this.conversationService.getConversationOrThrow(
                body.conversationId,
            );

        this.conversationService.ensureMemberInConversation(
            conversation,
            payload._id,
        );

        const conversationId = conversation._id.toString();
        const roomName = getRoomNameConversation(conversationId);
        await client.join(roomName);
        const countOnline = await this.redisService.getUserOnlineInListIds(
            conversation.users,
        );
        const membersOnline = countOnline.map((id) => id.toString());

        return {
            ok: true,
            data: {
                conversationId,
                roomName,
                joined: true,
                membersOnline,
            },
        };
    }

    async createMessage(
        client: Socket,
        body: CreateMessageSocketDto,
    ): Promise<SocketResponse<CreateMessageResult>> {
        const payload =
            await this.realtimeAuthService.validateActiveSession(client);

        const rateLimitState = await this.getEventRateLimitState(
            payload._id,
            'chat:create-message',
            SOCKET_EVENT_RATE_LIMIT.CREATE_MESSAGE,
        );
        if (rateLimitState.limited) {
            throw new BadRequestException({
                message: REALTIME_MESSAGES.EVENT_RATE_LIMITED(
                    rateLimitState.retryAfterSeconds,
                ),
                retryAfterSeconds: rateLimitState.retryAfterSeconds,
            });
        }

        const { conversationId, content, replyTo } = body;
        const { message } = await this.messageService.createMessage(
            payload._id,
            conversationId,
            MessageEnumType.TEXT,
            content,
            replyTo,
        );

        return {
            ok: true,
            data: {
                created: true,
                message,
            },
        };
    }

    async heartbeat(client: Socket): Promise<SocketResponse<HeartbeatResult>> {
        const payload =
            await this.realtimeAuthService.validateActiveSession(client);
        await this.redisService.setPresence(payload._id);

        return {
            ok: true,
            data: {
                setPresence: true,
            },
        };
    }

    async typingStart(
        client: Socket,
        body: TypingSocketDto,
    ): Promise<SocketResponse<TypingResult>> {
        const payload =
            await this.realtimeAuthService.validateActiveSession(client);

        const rateLimitState = await this.getEventRateLimitState(
            payload._id,
            'chat:typing-start',
            SOCKET_EVENT_RATE_LIMIT.TYPING,
        );
        if (rateLimitState.limited) {
            return {
                ok: true,
                data: { setTyping: true },
            };
        }

        const { conversation } =
            await this.conversationService.getConversationOrThrow(
                body.conversationId,
            );
        this.conversationService.ensureMemberInConversation(
            conversation,
            payload._id,
        );
        const status = await this.redisService.setTypingConversation(
            payload._id,
            body.conversationId,
            client.id,
        );
        if (status === 'new') {
            const typingCount =
                await this.redisService.countTypingConversations(
                    payload._id,
                    body.conversationId,
                );
            if (typingCount === 1) {
                const roomName = getRoomNameConversation(body.conversationId);
                const typingData: TypingEventPayload = {
                    conversationId: body.conversationId,
                    userId: payload._id,
                    typing: true,
                };
                const blockedRooms = await this.getBlockedUserRooms(
                    conversation,
                    payload._id,
                );
                client
                    .to(roomName)
                    .except(blockedRooms)
                    .emit(SOCKET_EVENTS.USER_TYPING_UPDATE, typingData);
            }
        }

        return {
            ok: true,
            data: {
                setTyping: true,
            },
        };
    }

    async typingStop(
        client: Socket,
        body: TypingSocketDto,
    ): Promise<SocketResponse<TypingResult>> {
        const payload =
            await this.realtimeAuthService.validateActiveSession(client);

        const rateLimitState = await this.getEventRateLimitState(
            payload._id,
            'chat:typing-stop',
            SOCKET_EVENT_RATE_LIMIT.TYPING,
        );
        if (rateLimitState.limited) {
            return {
                ok: true,
                data: { setTyping: false },
            };
        }

        const { conversation } =
            await this.conversationService.getConversationOrThrow(
                body.conversationId,
            );
        this.conversationService.ensureMemberInConversation(
            conversation,
            payload._id,
        );
        const result = await this.redisService.removeTypingConversation(
            payload._id,
            body.conversationId,
            client.id,
        );
        if (result) {
            const typingCount =
                await this.redisService.countTypingConversations(
                    payload._id,
                    body.conversationId,
                );
            if (typingCount === 0) {
                const roomName = getRoomNameConversation(body.conversationId);
                const typingData: TypingEventPayload = {
                    conversationId: body.conversationId,
                    userId: payload._id,
                    typing: false,
                };
                const blockedRooms = await this.getBlockedUserRooms(
                    conversation,
                    payload._id,
                );
                client
                    .to(roomName)
                    .except(blockedRooms)
                    .emit(SOCKET_EVENTS.USER_TYPING_UPDATE, typingData);
            }
        }

        return {
            ok: true,
            data: {
                setTyping: false,
            },
        };
    }

    async markRead(
        server: Server,
        client: Socket,
        body: MarkReadSocketDto,
    ): Promise<SocketResponse<MarkReadResult>> {
        const payload =
            await this.realtimeAuthService.validateActiveSession(client);

        const rateLimitState = await this.getEventRateLimitState(
            payload._id,
            'chat:mark-read',
            SOCKET_EVENT_RATE_LIMIT.MARK_READ,
        );
        if (rateLimitState.limited) {
            return {
                ok: true,
                data: { markRead: true },
            };
        }

        await this.conversationService.markAsRead(
            body.conversationId,
            payload._id,
            body.messageId,
        );
        await this.redisService.removeUnseenConversationWithCleanup(
            payload._id,
            body.conversationId,
        );
        const roomNameConversation = getRoomNameConversation(
            body.conversationId,
        );
        const roomNameUser = getRoomNameUser(payload._id);
        const eventData: MarkReadEventPayload = {
            conversationId: body.conversationId,
            userId: payload._id,
            messageId: body.messageId,
        };

        client.to(roomNameConversation).emit(SOCKET_EVENTS.USER_MARK_READ, eventData);

        server.to(roomNameUser).emit(SOCKET_EVENTS.USER_UNSEEN_CLEARED, {
            conversationId: body.conversationId,
        });

        return {
            ok: true,
            data: {
                markRead: true,
            },
        };
    }

    async deleteMessage(
        server: Server,
        client: Socket,
        body: { conversationId: string; messageId: string },
    ): Promise<SocketResponse<SoftDeleteMessageResult>> {
        const payload =
            await this.realtimeAuthService.validateActiveSession(client);

        await this.messageService.softDeleteMessage(
            body.messageId,
            body.conversationId,
            payload._id,
        );

        const roomName = getRoomNameConversation(body.conversationId);
        const eventPayload: SoftDeleteMessagePayload = {
            conversationId: body.conversationId,
            messageId: body.messageId,
            deletedBy: payload._id,
        };
        const { conversation } =
            await this.conversationService.getConversationOrThrow(
                body.conversationId,
            );
        const blockedRooms = await this.getBlockedUserRooms(
            conversation,
            payload._id,
        );
        server
            .to(roomName)
            .except(blockedRooms)
            .emit(SOCKET_EVENTS.CHAT_MESSAGE_DELETED, eventPayload);

        return {
            ok: true,
            data: { deleted: true },
        };
    }

    async updateMessage(
        client: Socket,
        body: UpdateMessageSocketDto,
    ): Promise<SocketResponse<UpdateMessageResult>> {
        const payload =
            await this.realtimeAuthService.validateActiveSession(client);
        await this.messageService.updateMessageContent(
            payload._id,
            body.messageId,
            body.content,
            body.conversationId,
        );

        return {
            ok: true,
            data: { updated: true, messageId: body.messageId },
        };
    }
}
