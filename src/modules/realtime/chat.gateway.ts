/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { REALTIME_MESSAGES } from './constants/realtime.constant';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
    Ack,
    ConnectedSocket,
    MessageBody,
    OnGatewayConnection,
    OnGatewayDisconnect,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { OnEvent } from '@nestjs/event-emitter';
import { MessagesService } from '../messages/messages.service';
import { ConversationsService } from '../conversations/conversations.service';
import { PayloadJWT } from '../users/schemas/user.schema';
import {
    formatDateTime,
    getRoomNameConversation,
    getRoomNameUser,
} from '@/utils/utils';
import { CreateMessageSocketDto } from '../messages/dto/create-message.dto';
import {
    MarkReadSocketDto,
    TypingSocketDto,
    UpdateMessageSocketDto,
} from './dto/chat-socket.dto';
import { RedisService } from '@/redis/redis.service';
import {
    CreateMessageResult,
    JoinConversationResult,
    SocketResponse,
    TypingEventPayload,
    MarkReadEventPayload,
    UserOfflinePayload,
    UserOnlinePayload,
    HeartbeatResult,
    TypingResult,
    MarkReadResult,
    SoftDeleteMessageResult,
    SoftDeleteMessagePayload,
    UpdateMessageResult,
    RelationshipCreatedPayload,
    RelationshipAcceptedPayload,
    RelationshipDeletedPayload,
    RelationshipBlockedPayload,
    PinMessageEventPayload,
    UnpinMessageEventPayload,
} from './types/responseSocket';
import { UsersService } from '../users/users.service';
import { USER_MESSAGES } from '../users/constants/user.constant';
import { AUTH_MESSAGES } from '@/auth/constants/auth.constant';
import { SessionService } from '../session/session.service';
import { MessageEnumType } from '../messages/types/message';
import { RelationshipsService } from '../relationships/relationships.service';
import { Notification } from '../notifications/schemas/notification.schema';
@WebSocketGateway({
    cors: { origin: '*' },
    transports: ['websocket'],
})
@Injectable()
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    constructor(
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
        private readonly messageService: MessagesService,
        private readonly conversationService: ConversationsService,
        private readonly redisService: RedisService,
        private readonly usersService: UsersService,
        private readonly sessionService: SessionService,
        private readonly relationshipsService: RelationshipsService,
    ) {}

    /**
     * Xử lý một kết nối Socket mới.
     * Sau khi xác thực JWT, socket được gắn payload user, join vào room cá nhân,
     * cập nhật presence trong Redis và broadcast `user:online` tới các conversation
     * mà user hiện đang tham gia để các client khác đồng bộ trạng thái online.
     */
    async handleConnection(client: Socket) {
        try {
            const token = client.handshake.auth?.token as string | undefined;

            if (!token) {
                throw new UnauthorizedException(
                    REALTIME_MESSAGES.MISSING_TOKEN,
                );
            }

            const payload: PayloadJWT = await this.jwtService.verifyAsync(
                token,
                {
                    secret: this.configService.get<string>('JWT_SECRET'),
                },
            );

            const user = await this.usersService.findOne(payload._id);
            if (!user) {
                throw new UnauthorizedException(USER_MESSAGES.USER_NOT_FOUND);
            }
            if (user.isDisabled) {
                throw new UnauthorizedException(AUTH_MESSAGES.USER_DISABLED);
            }
            if (user.banUntil && user.banUntil > new Date()) {
                const time = formatDateTime(user.banUntil);
                throw new UnauthorizedException(
                    AUTH_MESSAGES.ACCOUNT_BANNED_UNTIL(time),
                );
            }
            if (payload.tokenVersion !== user.tokenVersion) {
                throw new UnauthorizedException(
                    AUTH_MESSAGES.TOKEN_VERSION_MISMATCH,
                );
            }
            const session = await this.sessionService.findSessionById(
                payload.sessionId,
            );
            if (payload._id !== session?.userId.toString()) {
                throw new UnauthorizedException(
                    AUTH_MESSAGES.SESSION_USER_NOT_MATCH,
                );
            }
            if (session?.isRevoked || !session) {
                throw new UnauthorizedException(AUTH_MESSAGES.SESSION_REVOKED);
            }
            client.data.user = payload;
            const roomName = getRoomNameUser(payload._id);
            client.join(roomName);
            await this.redisService.setPresence(payload._id);
            const listConver =
                await this.conversationService.getAllConversationIdsByUser(
                    payload._id,
                );
            if (listConver.length > 0) {
                listConver.forEach((conversationId) => {
                    const userOnline: UserOnlinePayload = {
                        userId: payload._id,
                    };
                    this.server
                        .to(getRoomNameConversation(conversationId))
                        .emit('user:online', userOnline);
                });
            }
        } catch (error) {
            console.log('Socket auth failed: ', error);
            client.disconnect();
        }
    }

    /**
     * Xử lý sự kiện khi client ngắt kết nối.
     * Hiện tại không cần logic phức tạp vì trạng thái online quản lý bằng TTL của Redis Heartbeat.
     */
    handleDisconnect(client: Socket) {}

    /**
     * Đăng ký toàn bộ realtime bridge giữa domain service/Redis và Socket.IO.
     * Bao gồm:
     * - Presence và typing từ Redis.
     * - Sự kiện conversation như tạo group, thêm/xóa thành viên, giải tán nhóm.
     * - Sự kiện khôi phục conversation đã bị ẩn khi có tin nhắn mới đầu tiên.
     */
    onModuleInit() {
        this.redisService.userOffline$.subscribe(async (userId) => {
            try {
                const listConver =
                    await this.conversationService.getAllConversationIdsByUser(
                        userId,
                    );
                const lastOnlineAt = new Date();
                if (listConver.length > 0) {
                    listConver.forEach((conversationId) => {
                        const roomName =
                            getRoomNameConversation(conversationId);
                        const userOffline: UserOfflinePayload = {
                            userId,
                            lastOnlineAt,
                        };
                        this.server
                            .to(roomName)
                            .emit('user:offline', userOffline);
                    });
                }
                await this.usersService.setLastOnline(userId);
            } catch (error) {
                console.log('Error user offline:', error);
            }
        });

        this.redisService.userTypingStop$.subscribe(
            async ({ userId, conversationId }) => {
                try {
                    const isStillTyping =
                        await this.redisService.hasTypingConversation(
                            userId,
                            conversationId,
                        );
                    if (isStillTyping) {
                        return;
                    }
                    const roomName = getRoomNameConversation(conversationId);
                    const typingData: TypingEventPayload = {
                        conversationId,
                        userId,
                        typing: false,
                    };
                    this.server
                        .to(roomName)
                        .emit('user:typing-update', typingData);
                } catch (error) {
                    console.log('Error user typing stop:', error);
                }
            },
        );

        this.conversationService.conversationDisbanded$.subscribe(
            ({ conversationId, memberIds }) => {
                memberIds.forEach((memberId) => {
                    this.server
                        .to(getRoomNameUser(memberId))
                        .emit('conversation:disbanded', { conversationId });
                });
            },
        );

        this.conversationService.memberAdded$.subscribe(
            ({ conversationId, addedMemberIds, adderId }) => {
                const roomName = getRoomNameConversation(conversationId);
                this.server.to(roomName).emit('conversation:member-added', {
                    conversationId,
                    addedMemberIds,
                    adderId,
                });
                addedMemberIds.forEach((memberId) => {
                    this.server
                        .to(getRoomNameUser(memberId))
                        .emit('conversation:member-added', {
                            conversationId,
                            addedMemberIds,
                            adderId,
                        });
                });
            },
        );

        this.conversationService.memberRemoved$.subscribe(
            ({ conversationId, removedMemberId, removerId }) => {
                const roomName = getRoomNameConversation(conversationId);
                const userRoom = getRoomNameUser(removedMemberId);
                this.server.in(userRoom).socketsLeave(roomName);
                this.server.to(roomName).emit('conversation:member-removed', {
                    conversationId,
                    removedMemberId,
                    removerId,
                });
                this.server.to(userRoom).emit('conversation:member-removed', {
                    conversationId,
                    removedMemberId,
                    removerId,
                });
            },
        );

        this.conversationService.conversationGroupCreated$.subscribe(
            ({ conversationId, memberIds }) => {
                memberIds.forEach((memberId) => {
                    this.server
                        .to(getRoomNameUser(memberId))
                        .emit('conversation:group-created', {
                            conversationId,
                        });
                });
            },
        );

        this.messageService.restoredConversation$.subscribe({
            next: ({ conversationId, members }) => {
                members.forEach((memberId) => {
                    this.server
                        .to(getRoomNameUser(memberId))
                        .emit('conversation:restored', {
                            conversationId,
                        });
                });
            },
        });

        this.messageService.updatedMessage$.subscribe({
            next: (message) => {
                this.server
                    .to(
                        getRoomNameConversation(
                            message.conversationId.toString(),
                        ),
                    )
                    .emit('message:updated', message);
            },
        });

        this.conversationService.conversationNameChanged$.subscribe(
            ({ conversationId, name }) => {
                const roomName = getRoomNameConversation(conversationId);
                this.server.to(roomName).emit('conversation:name-changed', {
                    conversationId,
                    name,
                });
            },
        );

        this.conversationService.conversationAdminChanged$.subscribe(
            ({ conversationId, newAdminId, membersOnline }) => {
                membersOnline.forEach((memberId) => {
                    this.server
                        .to(getRoomNameUser(memberId))
                        .emit('conversation:admin-changed', {
                            conversationId,
                            newAdminId,
                        });
                });
            },
        );

        this.messageService.createdMessage$.subscribe({
            next: (message) => {
                const roomName = getRoomNameConversation(
                    message.conversationId.toString(),
                );
                this.server.to(roomName).emit('chat:new-message', message);
            },
        });

        this.messageService.pinnedMessage$.subscribe({
            next: ({ conversationId, messageId }) => {
                const payload: PinMessageEventPayload = {
                    conversationId,
                    messageId,
                };
                this.server
                    .to(getRoomNameConversation(conversationId))
                    .emit('message:pinned', payload);
            },
        });

        this.messageService.unpinnedMessage$.subscribe({
            next: ({ conversationId, messageId }) => {
                const payload: UnpinMessageEventPayload = {
                    conversationId,
                    messageId,
                };
                this.server
                    .to(getRoomNameConversation(conversationId))
                    .emit('message:unpinned', payload);
            },
        });

        this.messageService.unseenMessage$.subscribe({
            next: ({ conversationId, userIds }) => {
                userIds.forEach((userId) => {
                    this.server
                        .to(getRoomNameUser(userId))
                        .emit('user:unseen-message', {
                            conversationId,
                        });
                });
            },
        });

        this.usersService.userDisabled$.subscribe(async ({ userId }) => {
            try {
                // Emit event to all rooms the user is in so UI updates instantly
                const listConver =
                    await this.conversationService.getAllConversationIdsByUser(
                        userId,
                    );
                if (listConver.length > 0) {
                    listConver.forEach((conversationId) => {
                        const roomName =
                            getRoomNameConversation(conversationId);
                        this.server
                            .to(roomName)
                            .emit('user:disabled', { userId });
                    });
                }

                // Also emit to the user's personal room so their own clients can log out
                this.server
                    .to(getRoomNameUser(userId))
                    .emit('user:disabled', { userId });

                // Force disconnect all sockets of this user
                this.server.in(getRoomNameUser(userId)).disconnectSockets(true);
            } catch (error) {
                console.log('Error user disabled event:', error);
            }
        });

        this.relationshipsService.relationshipCreated$.subscribe(
            ({ recipientId }) => {
                const payload: RelationshipCreatedPayload = { recipientId };
                this.server
                    .to(getRoomNameUser(recipientId))
                    .emit('relationship:created', payload);
            },
        );

        this.relationshipsService.relationshipAccepted$.subscribe(
            ({ userIds }) => {
                userIds.forEach((userId) => {
                    const payload: RelationshipAcceptedPayload = {
                        userIds,
                    };
                    this.server
                        .to(getRoomNameUser(userId))
                        .emit('relationship:accepted', payload);
                });
            },
        );

        this.relationshipsService.relationshipDeleted$.subscribe(
            ({ targetUserId }) => {
                const payload: RelationshipDeletedPayload = { targetUserId };
                this.server
                    .to(getRoomNameUser(targetUserId))
                    .emit('relationship:deleted', payload);
            },
        );

        this.relationshipsService.relationshipBlocked$.subscribe(
            ({ targetUserId }) => {
                const payload: RelationshipBlockedPayload = { targetUserId };
                this.server
                    .to(getRoomNameUser(targetUserId))
                    .emit('relationship:blocked', payload);
            },
        );

        this.relationshipsService.relationshipUnblocked$.subscribe(
            ({ targetUserId }) => {
                const payload = { targetUserId };
                this.server
                    .to(getRoomNameUser(targetUserId))
                    .emit('relationship:unblocked', payload);
            },
        );
    }

    @OnEvent('notification.created')
    handleNotificationCreated({
        notificationId,
        userId,
    }: {
        notificationId: string;
        userId: string;
    }) {
        this.server
            .to(getRoomNameUser(userId))
            .emit('notification:created', notificationId);
    }

    @OnEvent('user.banned')
    handleUserBanned(payload: { userId: string; banUntil: Date }) {
        const roomName = getRoomNameUser(payload.userId);
        this.server
            .to(roomName)
            .emit('user:banned', { banUntil: payload.banUntil });
        this.server.in(roomName).disconnectSockets(true);
    }

    @OnEvent('user.muted')
    handleUserMuted(payload: { userId: string; muteUntil: Date }) {
        const roomName = getRoomNameUser(payload.userId);
        this.server
            .to(roomName)
            .emit('user:muted', { muteUntil: payload.muteUntil });
    }

    @OnEvent('user.unmuted')
    handleUserUnmuted(payload: { userId: string }) {
        const roomName = getRoomNameUser(payload.userId);
        this.server.to(roomName).emit('user:unmuted', {
            userId: payload.userId,
        });
    }

    /**
     * Lắng nghe sự kiện `chat:join-conversation`.
     * Khi user click mở một khung chat, hệ thống cho user join vào room Socket.IO của phòng đó.
     * Trả về danh sách user đang online trong phòng chat.
     */
    @SubscribeMessage('chat:join-conversation')
    async handleJoinConversation(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: { conversationId: string },
        @Ack() ack: (response: any) => void,
    ) {
        try {
            const payload = await this.validateActiveSession(client);

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

            const res: SocketResponse<JoinConversationResult> = {
                ok: true,
                data: {
                    conversationId,
                    roomName,
                    joined: true,
                    membersOnline,
                },
            };
            ack?.(res);
        } catch (error) {
            console.log('Error joining conversation:', error);
            const res: SocketResponse = {
                ok: false,
                message:
                    error instanceof Error ? error.message : 'Unknown error',
            };
            ack?.(res);
        }
    }

    /**
     * Lắng nghe sự kiện gửi tin nhắn mới `chat:create-message`.
     * Lưu tin vào DB, sau đó broadcast sự kiện `chat:new-message` cho mọi người trong room.
     * Kích hoạt cờ "Unseen message" qua Redis cho những user đang online ở các tab khác.
     */
    @SubscribeMessage('chat:create-message')
    async handleCreateMessage(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: CreateMessageSocketDto,
        @Ack() ack: (response: any) => void,
    ) {
        try {
            const payload = await this.validateActiveSession(client);

            const { conversationId, content, replyTo } = body;
            const { message } = await this.messageService.createMessage(
                payload._id,
                conversationId,
                MessageEnumType.TEXT,
                content,
                replyTo,
            );

            const res: SocketResponse<CreateMessageResult> = {
                ok: true,
                data: {
                    created: true,
                    message,
                },
            };
            ack?.(res);
        } catch (error) {
            console.log('Error creating message:', error);
            const res: SocketResponse = {
                ok: false,
                message:
                    error instanceof Error ? error.message : 'Unknown error',
            };
            ack?.(res);
        }
    }

    /**
     * Lắng nghe sự kiện Heartbeat (ping) từ client.
     * Gia hạn thời gian sống (TTL) của trạng thái Online trên Redis.
     */
    @SubscribeMessage('user:heartbeat')
    async handleUserHeartbeat(
        @ConnectedSocket() client: Socket,
        @Ack() ack: (response: any) => void,
    ) {
        try {
            const payload = await this.validateUse(client);
            await this.redisService.setPresence(payload._id);
            const res: SocketResponse<HeartbeatResult> = {
                ok: true,
                data: {
                    setPresence: true,
                },
            };
            ack?.(res);
        } catch (error) {
            console.log('Error user heartbeat:', error);
            const res: SocketResponse = {
                ok: false,
                message:
                    error instanceof Error ? error.message : 'Unknown error',
            };
            ack?.(res);
        }
    }

    /**
     * Bắt đầu gõ phím.
     * Update trạng thái Typing lên Redis và phát broadcast `user:typing-update` cho phòng.
     */
    @SubscribeMessage('chat:typing-start')
    async handleTypingStart(
        @ConnectedSocket() client: Socket,
        @Ack() ack: (response: any) => void,
        @MessageBody() body: TypingSocketDto,
    ) {
        try {
            const payload = await this.validateUse(client);
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
                    const roomName = getRoomNameConversation(
                        body.conversationId,
                    );
                    const typingData: TypingEventPayload = {
                        conversationId: body.conversationId,
                        userId: payload._id,
                        typing: true,
                    };
                    client.to(roomName).emit('user:typing-update', typingData);
                }
            }
            const res: SocketResponse<TypingResult> = {
                ok: true,
                data: {
                    setTyping: true,
                },
            };
            ack?.(res);
        } catch (error) {
            console.log('Error typing start:', error);
            const res: SocketResponse = {
                ok: false,
                message:
                    error instanceof Error ? error.message : 'Unknown error',
            };
            ack?.(res);
        }
    }

    /**
     * Ngừng gõ phím.
     * Xóa trạng thái Typing trên Redis và phát broadcast hủy Typing cho phòng.
     */
    @SubscribeMessage('chat:typing-stop')
    async handleTypingStop(
        @ConnectedSocket() client: Socket,
        @Ack() ack: (response: any) => void,
        @MessageBody() body: TypingSocketDto,
    ) {
        try {
            const payload = await this.validateUse(client);
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
                    const roomName = getRoomNameConversation(
                        body.conversationId,
                    );
                    const typingData: TypingEventPayload = {
                        conversationId: body.conversationId,
                        userId: payload._id,
                        typing: false,
                    };
                    client.to(roomName).emit('user:typing-update', typingData);
                }
            }
            const res: SocketResponse<TypingResult> = {
                ok: true,
                data: {
                    setTyping: false,
                },
            };
            ack?.(res);
        } catch (error) {
            console.log('Error typing stop:', error);
            const res: SocketResponse = {
                ok: false,
                message:
                    error instanceof Error ? error.message : 'Unknown error',
            };
            ack?.(res);
        }
    }

    /**
     * Sự kiện "Đã xem" tin nhắn.
     * Cập nhật `readReceipts` trong Database và broadcast cho các thành viên khác biết.
     */
    @SubscribeMessage('chat:mark-read')
    async handleMarkRead(
        @ConnectedSocket() client: Socket,
        @Ack() ack: (response: any) => void,
        @MessageBody() body: MarkReadSocketDto,
    ) {
        try {
            const payload = await this.validateActiveSession(client);
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

            client.to(roomNameConversation).emit('user:mark-read', eventData);

            this.server.to(roomNameUser).emit('user:unseen-cleared', {
                conversationId: body.conversationId,
            });

            const res: SocketResponse<MarkReadResult> = {
                ok: true,
                data: {
                    markRead: true,
                },
            };
            ack?.(res);
        } catch (error) {
            console.log('Error marking as read:', error);
            const res: SocketResponse = {
                ok: false,
                message:
                    error instanceof Error ? error.message : 'Unknown error',
            };
            ack?.(res);
        }
    }

    /**
     * Thu hồi tin nhắn
     */
    @SubscribeMessage('chat:delete-message')
    async handleDeleteMessage(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: { conversationId: string; messageId: string },
        @Ack() ack: (response: any) => void,
    ) {
        try {
            const payload = await this.validateActiveSession(client);

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
            this.server.to(roomName).emit('chat:message-deleted', eventPayload);

            const res: SocketResponse<SoftDeleteMessageResult> = {
                ok: true,
                data: { deleted: true },
            };
            ack?.(res);
        } catch (error) {
            console.log('Error deleting message:', error);
            const res: SocketResponse = {
                ok: false,
                message:
                    error instanceof Error ? error.message : 'Unknown error',
            };
            ack?.(res);
        }
    }

    /**
     * Chỉnh sửa nội dung tin nhắn
     */
    @SubscribeMessage('chat:update-message')
    async handleUpdateMessage(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        body: UpdateMessageSocketDto,
        @Ack() ack: (response: any) => void,
    ) {
        try {
            const payload = await this.validateActiveSession(client);
            await this.messageService.updateMessageContent(
                payload._id,
                body.messageId,
                body.content,
                body.conversationId,
            );

            const res: SocketResponse<UpdateMessageResult> = {
                ok: true,
                data: { updated: true, messageId: body.messageId },
            };
            ack?.(res);
        } catch (error) {
            console.log('Error updating message:', error);
            const res: SocketResponse = {
                ok: false,
                message:
                    error instanceof Error ? error.message : 'Unknown error',
            };
            ack?.(res);
        }
    }

    /**
     * Helper: Xác thực và lấy payload JWT từ Socket.
     */
    private async validateUse(client: Socket) {
        const payload = client.data.user as PayloadJWT | undefined;
        if (payload?._id) {
            return payload;
        }

        const token = client.handshake.auth?.token as string | undefined;
        if (!token) {
            throw new UnauthorizedException(REALTIME_MESSAGES.MISSING_TOKEN);
        }

        const verifiedPayload: PayloadJWT = await this.jwtService.verifyAsync(
            token,
            {
                secret: this.configService.get<string>('JWT_SECRET'),
            },
        );
        client.data.user = verifiedPayload;

        return verifiedPayload;
    }

    /**
     * Re-check user/session state for write actions so old sockets cannot keep
     * mutating data after logout, logout-all, or session revocation.
     */
    private async validateActiveSession(client: Socket) {
        const payload = await this.validateUse(client);

        const user = await this.usersService.findOne(payload._id);
        if (!user) {
            client.disconnect();
            throw new UnauthorizedException(USER_MESSAGES.USER_NOT_FOUND);
        }
        if (user.isDisabled) {
            client.disconnect();
            throw new UnauthorizedException(AUTH_MESSAGES.USER_DISABLED);
        }

        if (user.banUntil && user.banUntil > new Date()) {
            client.disconnect();
            const time = formatDateTime(user.banUntil);
            throw new UnauthorizedException(
                AUTH_MESSAGES.ACCOUNT_BANNED_UNTIL(time),
            );
        }

        if (payload.tokenVersion !== user.tokenVersion) {
            client.disconnect();
            throw new UnauthorizedException(
                AUTH_MESSAGES.TOKEN_VERSION_MISMATCH,
            );
        }

        const session = await this.sessionService.findSessionById(
            payload.sessionId,
        );
        if (!session) {
            client.disconnect();
            throw new UnauthorizedException(AUTH_MESSAGES.SESSION_NOT_FOUND);
        }

        if (session.userId.toString() !== payload._id) {
            client.disconnect();
            throw new UnauthorizedException(
                AUTH_MESSAGES.SESSION_USER_NOT_MATCH,
            );
        }

        if (session.isRevoked) {
            client.disconnect();
            throw new UnauthorizedException(AUTH_MESSAGES.SESSION_REVOKED);
        }

        return payload;
    }
}
