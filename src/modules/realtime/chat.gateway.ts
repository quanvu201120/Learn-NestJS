/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { AUTH_MESSAGES } from '@/auth/constants/auth.constant';
import { RedisService } from '@/redis/redis.service';
import {
    formatDateTime,
    getRoomNameConversation,
    getRoomNameUser,
} from '@/utils/utils';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
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
import { ConversationsService } from '../conversations/conversations.service';
import { CreateMessageSocketDto } from '../messages/dto/create-message.dto';
import { SessionService } from '../session/session.service';
import { USER_MESSAGES } from '../users/constants/user.constant';
import { PayloadJWT } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { REALTIME_MESSAGES } from './constants/realtime.constant';
import {
    MarkReadSocketDto,
    TypingSocketDto,
    UpdateMessageSocketDto,
} from './dto/chat-socket.dto';
import { RealtimeChatCommandService } from './realtime-chat-command.service';
import { RealtimeEventBridgeService } from './realtime-event-bridge.service';
import { SocketResponse, UserOnlinePayload } from './types/responseSocket';
import { RealtimeCallService } from './realtime-call.service';
import {
    CallAnswerSocketDto,
    CallIdSocketDto,
    CallHeartbeatSocketDto,
    CallIceCandidateSocketDto,
    CallOfferSocketDto,
    EndCallSocketDto,
    StartCallSocketDto,
} from './dto/call-socket.dto';

const socketCorsOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

@WebSocketGateway({
    cors: { origin: socketCorsOrigins },
    transports: ['websocket'],
})
@Injectable()
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    constructor(
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
        private readonly conversationService: ConversationsService,
        private readonly redisService: RedisService,
        private readonly usersService: UsersService,
        private readonly sessionService: SessionService,
        private readonly realtimeChatCommandService: RealtimeChatCommandService,
        private readonly realtimeEventBridgeService: RealtimeEventBridgeService,
        private readonly realtimeCallService: RealtimeCallService,
    ) {}

    /**
     * Xử lý một kết nối Socket mới.
     * Sau khi xác thực JWT, socket được gắn payload user, join vào room cá nhân,
     * cập nhật presence trong Redis và broadcast `user:online` tới các conversation
     * mà user hiện đang tham gia để các client khác đồng bộ trạng thái online.
     */
    /**
     * Xác thực socket khi client vừa connect và join room cá nhân cho user.
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
    async handleDisconnect(client: Socket) {
        const payload = client.data.user as PayloadJWT | undefined;
        const activeCallId = client.data.activeCallId as string | undefined;
        if (!payload?._id) {
            return;
        }
        if (!activeCallId) {
            return;
        }

        try {
            await this.realtimeCallService.handleDisconnectedUser(
                this.server,
                payload._id,
                activeCallId,
            );
        } catch (error) {
            console.log('Error handling call disconnect:', error);
        }
    }

    /**
     * Đăng ký toàn bộ realtime bridge giữa domain service/Redis và Socket.IO.
     */
    onModuleInit() {
        this.realtimeEventBridgeService.register(this.server);
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
            const res = await this.realtimeChatCommandService.joinConversation(
                client,
                body,
            );
            ack?.(res);
        } catch (error) {
            console.log('Error joining conversation:', error);
            ack?.(this.toErrorResponse(error));
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
            const res = await this.realtimeChatCommandService.createMessage(
                client,
                body,
            );
            ack?.(res);
        } catch (error) {
            console.log('Error creating message:', error);
            ack?.(this.toErrorResponse(error));
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
            const res = await this.realtimeChatCommandService.heartbeat(client);
            ack?.(res);
        } catch (error) {
            console.log('Error user heartbeat:', error);
            ack?.(this.toErrorResponse(error));
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
            const res = await this.realtimeChatCommandService.typingStart(
                client,
                body,
            );
            ack?.(res);
        } catch (error) {
            console.log('Error typing start:', error);
            ack?.(this.toErrorResponse(error));
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
            const res = await this.realtimeChatCommandService.typingStop(
                client,
                body,
            );
            ack?.(res);
        } catch (error) {
            console.log('Error typing stop:', error);
            ack?.(this.toErrorResponse(error));
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
            const res = await this.realtimeChatCommandService.markRead(
                this.server,
                client,
                body,
            );
            ack?.(res);
        } catch (error) {
            console.log('Error marking as read:', error);
            ack?.(this.toErrorResponse(error));
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
            const res = await this.realtimeChatCommandService.deleteMessage(
                this.server,
                client,
                body,
            );
            ack?.(res);
        } catch (error) {
            console.log('Error deleting message:', error);
            ack?.(this.toErrorResponse(error));
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
            const res = await this.realtimeChatCommandService.updateMessage(
                client,
                body,
            );
            ack?.(res);
        } catch (error) {
            console.log('Error updating message:', error);
            ack?.(this.toErrorResponse(error));
        }
    }

    /**
     * Nhận yêu cầu bắt đầu cuộc gọi từ client và chuyển xuống realtime call service.
     */
    @SubscribeMessage('call:start')
    async handleCallStart(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: StartCallSocketDto,
        @Ack() ack: (response: any) => void,
    ) {
        try {
            const res = await this.realtimeCallService.startCall(
                this.server,
                client,
                body,
            );
            ack?.(res);
        } catch (error) {
            console.log('Error starting call:', error);
            ack?.(this.toErrorResponse(error));
        }
    }

    /**
     * Nhận tín hiệu chấp nhận cuộc gọi từ client.
     */
    @SubscribeMessage('call:accept')
    async handleCallAccept(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: CallIdSocketDto,
        @Ack() ack: (response: any) => void,
    ) {
        try {
            const res = await this.realtimeCallService.acceptCall(
                this.server,
                client,
                body,
            );
            ack?.(res);
        } catch (error) {
            console.log('Error accepting call:', error);
            ack?.(this.toErrorResponse(error));
        }
    }

    /**
     * Nhận tín hiệu từ chối cuộc gọi từ client.
     */
    @SubscribeMessage('call:reject')
    async handleCallReject(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: CallIdSocketDto,
        @Ack() ack: (response: any) => void,
    ) {
        try {
            const res = await this.realtimeCallService.rejectCall(
                this.server,
                client,
                body,
            );
            ack?.(res);
        } catch (error) {
            console.log('Error rejecting call:', error);
            ack?.(this.toErrorResponse(error));
        }
    }

    /**
     * Nhận tín hiệu kết thúc cuộc gọi từ client.
     */
    @SubscribeMessage('call:end')
    async handleCallEnd(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: EndCallSocketDto,
        @Ack() ack: (response: any) => void,
    ) {
        try {
            const res = await this.realtimeCallService.endCall(
                this.server,
                client,
                body,
            );
            ack?.(res);
        } catch (error) {
            console.log('Error ending call:', error);
            ack?.(this.toErrorResponse(error));
        }
    }

    /**
     * Gia hạn heartbeat cho cuộc gọi đang accepted.
     */
    @SubscribeMessage('call:heartbeat')
    async handleCallHeartbeat(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: CallHeartbeatSocketDto,
        @Ack() ack: (response: any) => void,
    ) {
        try {
            const res = await this.realtimeCallService.refreshCallHeartbeat(
                client,
                body,
            );
            ack?.(res);
        } catch (error) {
            console.log('Error refreshing call heartbeat:', error);
            ack?.(this.toErrorResponse(error));
        }
    }
    /**
     * Sync cuộc gọi `calling` còn hiệu lực sau khi reconnect socket.
     */
    @SubscribeMessage('call:sync')
    async handleCallSync(
        @ConnectedSocket() client: Socket,
        @Ack() ack: (response: any) => void,
    ) {
        try {
            const res = await this.realtimeCallService.syncActiveCall(client);
            ack?.(res);
        } catch (error) {
            console.log('Error syncing call:', error);
            ack?.(this.toErrorResponse(error));
        }
    }

    /**
     * Chuyển SDP offer giữa hai đầu cuộc gọi.
     */
    @SubscribeMessage('call:offer')
    async handleCallOffer(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: CallOfferSocketDto,
        @Ack() ack: (response: any) => void,
    ) {
        try {
            const res = await this.realtimeCallService.forwardOffer(
                this.server,
                client,
                body,
            );
            ack?.(res);
        } catch (error) {
            console.log('Error forwarding call offer:', error);
            ack?.(this.toErrorResponse(error));
        }
    }

    /**
     * Chuyển SDP answer giữa hai đầu cuộc gọi.
     */
    @SubscribeMessage('call:answer')
    async handleCallAnswer(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: CallAnswerSocketDto,
        @Ack() ack: (response: any) => void,
    ) {
        try {
            const res = await this.realtimeCallService.forwardAnswer(
                this.server,
                client,
                body,
            );
            ack?.(res);
        } catch (error) {
            console.log('Error forwarding call answer:', error);
            ack?.(this.toErrorResponse(error));
        }
    }

    /**
     * Chuyển ICE candidate giữa hai đầu cuộc gọi.
     */
    @SubscribeMessage('call:ice-candidate')
    async handleCallIceCandidate(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: CallIceCandidateSocketDto,
        @Ack() ack: (response: any) => void,
    ) {
        try {
            const res = await this.realtimeCallService.forwardIceCandidate(
                this.server,
                client,
                body,
            );
            ack?.(res);
        } catch (error) {
            console.log('Error forwarding ICE candidate:', error);
            ack?.(this.toErrorResponse(error));
        }
    }

    private toErrorResponse(error: unknown): SocketResponse {
        return {
            ok: false,
            message: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}
