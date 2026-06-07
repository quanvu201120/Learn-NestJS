/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
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
    ) {}

    async handleConnection(client: Socket) {
        try {
            const token = client.handshake.auth?.token as string | undefined;

            if (!token) {
                throw new UnauthorizedException('Missing token');
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

            console.log(
                'User ' +
                    payload._id +
                    ' connected with socket id ' +
                    client.id,
            );
        } catch (error) {
            console.log('Socket auth failed: ', error);
            client.disconnect();
        }
    }

    handleDisconnect(client: Socket) {
        console.log('Socket disconnected:', client.id);
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

            console.log(
                'User ' + payload._id + ' joined conversation ' + roomName,
            );

            ack({
                ok: true,
                data: {
                    conversationId,
                    roomName,
                    joined: true,
                },
            });
        } catch (error) {
            console.log('Error joining conversation:', error);
            ack({
                ok: false,
                message:
                    error instanceof Error ? error.message : 'Unknown error',
            });
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
            const message = await this.messageService.createMessage(
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
            ack({
                ok: true,
                data: {
                    created: true,
                    messageId: message._id.toString(),
                    conversationId,
                },
            });
        } catch (error) {
            console.log('Error creating message:', error);
            ack({
                ok: false,
                message:
                    error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    private validateUse(client: Socket) {
        const payload = client.data.user as PayloadJWT | undefined;
        if (!payload?._id) {
            throw new UnauthorizedException('Missing token');
        }

        return payload;
    }
}
