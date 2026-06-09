/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
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
import { MessagesService } from '../messages/messages.service';
import { ConversationsService } from '../conversations/conversations.service';
import { PayloadJWT } from '../users/schemas/user.schema';
import { getRoomNameConversation, getRoomNameUser } from '@/utils/utils';
import { CreateMessageSocketDto } from '../messages/dto/create-message.dto';
import { MarkReadSocketDto, TypingSocketDto } from './dto/chat-socket.dto';
import { RedisService } from '@/redis/redis.service';
import {
    CreatedMessageEvent,
    JoinConversationEvent,
    SocketResponse,
    TypingUpdateEvent,
    MarkReadEvent,
} from './types/responseSocket';

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
    ) {}

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
                    secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
                },
            );

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
                    this.server
                        .to(getRoomNameConversation(conversationId))
                        .emit('user:online', { userId: payload._id });
                });
            }
        } catch (error) {
            console.log('Socket auth failed: ', error);
            client.disconnect();
        }
    }

    handleDisconnect(client: Socket) {}

    onModuleInit() {
        this.redisService.userOffline$.subscribe(async (userId) => {
            try {
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
                            .emit('user:offline', { userId });
                    });
                }
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
                    const typingData: TypingUpdateEvent = {
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
    }

    @SubscribeMessage('chat:join-conversation')
    async handleJoinConversation(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: { conversationId: string },
        @Ack() ack: (response: any) => void,
    ) {
        try {
            const payload = this.validateUse(client);

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

            const res: SocketResponse<JoinConversationEvent> = {
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

    @SubscribeMessage('chat:create-message')
    async handleCreateMessage(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: CreateMessageSocketDto,
        @Ack() ack: (response: any) => void,
    ) {
        try {
            const payload = this.validateUse(client);
            const { conversationId, type, content, replyTo } = body;
            const { message, conversation } =
                await this.messageService.createMessage(
                    payload._id,
                    conversationId,
                    type,
                    content,
                    replyTo,
                );
            const roomName = getRoomNameConversation(conversationId);
            this.server
                .to(roomName)
                .emit('chat:new-message', { conversationId, message });

            const membersOnline = (
                await this.redisService.getUserOnlineInListIds(
                    conversation.users,
                )
            ).filter((item) => item.toString() !== payload._id.toString());

            if (membersOnline.length > 0) {
                const resultUnseen = await this.redisService.setUnseenMessage(
                    membersOnline,
                    conversationId,
                );
                if (resultUnseen) {
                    resultUnseen.forEach(([pipelineError, result], index) => {
                        if (!pipelineError && Number(result) > 0) {
                            const roomName = getRoomNameUser(
                                membersOnline[index].toString(),
                            );
                            this.server
                                .to(roomName)
                                .emit('user:unseen-message', {
                                    conversationId,
                                });
                        }
                    });
                }
            }

            const res: SocketResponse<CreatedMessageEvent> = {
                ok: true,
                data: {
                    created: true,
                    messageId: message._id.toString(),
                    conversationId,
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

    @SubscribeMessage('user:heartbeat')
    async handleUserHeartbeat(
        @ConnectedSocket() client: Socket,
        @Ack() ack: (response: any) => void,
    ) {
        try {
            const payload = this.validateUse(client);
            await this.redisService.setPresence(payload._id);
            ack?.({
                ok: true,
                data: {
                    setPresence: true,
                },
            });
        } catch (error) {
            console.log('Error user heartbeat:', error);
            ack?.({
                ok: false,
                message:
                    error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    @SubscribeMessage('chat:typing-start')
    async handleTypingStart(
        @ConnectedSocket() client: Socket,
        @Ack() ack: (response: any) => void,
        @MessageBody() body: TypingSocketDto,
    ) {
        try {
            const payload = this.validateUse(client);
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
                    const typingData: TypingUpdateEvent = {
                        conversationId: body.conversationId,
                        userId: payload._id,
                        typing: true,
                    };
                    client.to(roomName).emit('user:typing-update', typingData);
                }
            }
            const res: SocketResponse = {
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

    @SubscribeMessage('chat:typing-stop')
    async handleTypingStop(
        @ConnectedSocket() client: Socket,
        @Ack() ack: (response: any) => void,
        @MessageBody() body: TypingSocketDto,
    ) {
        try {
            const payload = this.validateUse(client);
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
                    const typingData: TypingUpdateEvent = {
                        conversationId: body.conversationId,
                        userId: payload._id,
                        typing: false,
                    };
                    client.to(roomName).emit('user:typing-update', typingData);
                }
            }
            const res: SocketResponse = {
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

    @SubscribeMessage('chat:mark-read')
    async handleMarkRead(
        @ConnectedSocket() client: Socket,
        @Ack() ack: (response: any) => void,
        @MessageBody() body: MarkReadSocketDto,
    ) {
        try {
            const payload = this.validateUse(client);
            await this.conversationService.markAsRead(
                body.conversationId,
                payload._id,
                body.messageId,
            );

            const roomName = getRoomNameConversation(body.conversationId);
            const eventData: MarkReadEvent = {
                conversationId: body.conversationId,
                userId: payload._id,
                messageId: body.messageId,
            };
            
            client.to(roomName).emit('user:mark-read', eventData);

            const res: SocketResponse = {
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

    private validateUse(client: Socket) {
        const payload = client.data.user as PayloadJWT | undefined;
        if (!payload?._id) {
            throw new UnauthorizedException(REALTIME_MESSAGES.MISSING_TOKEN);
        }

        return payload;
    }
}
