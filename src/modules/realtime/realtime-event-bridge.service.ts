import { RedisService } from '@/redis/redis.service';
import { getRoomNameConversation, getRoomNameUser } from '@/utils/utils';
import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';
import { ConversationsService } from '../conversations/conversations.service';
import { MessagesService } from '../messages/messages.service';
import { RelationshipsService } from '../relationships/relationships.service';
import { UsersService } from '../users/users.service';
import {
    PinMessageEventPayload,
    RelationshipAcceptedPayload,
    RelationshipBlockedPayload,
    RelationshipCreatedPayload,
    RelationshipDeletedPayload,
    TypingEventPayload,
    UnpinMessageEventPayload,
    UserOfflinePayload,
} from './types/responseSocket';

@Injectable()
export class RealtimeEventBridgeService {
    constructor(
        private readonly messageService: MessagesService,
        private readonly conversationService: ConversationsService,
        private readonly redisService: RedisService,
        private readonly usersService: UsersService,
        private readonly relationshipsService: RelationshipsService,
    ) {}

    register(server: Server) {
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
                        server.to(roomName).emit('user:offline', userOffline);
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
                    server.to(roomName).emit('user:typing-update', typingData);
                } catch (error) {
                    console.log('Error user typing stop:', error);
                }
            },
        );

        this.conversationService.conversationDisbanded$.subscribe(
            ({ conversationId, memberIds }) => {
                memberIds.forEach((memberId) => {
                    server
                        .to(getRoomNameUser(memberId))
                        .emit('conversation:disbanded', { conversationId });
                });
            },
        );

        this.conversationService.memberAdded$.subscribe(
            ({ conversationId, addedMemberIds, adderId }) => {
                const roomName = getRoomNameConversation(conversationId);
                server.to(roomName).emit('conversation:member-added', {
                    conversationId,
                    addedMemberIds,
                    adderId,
                });
                addedMemberIds.forEach((memberId) => {
                    server
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
                server.in(userRoom).socketsLeave(roomName);
                server.to(roomName).emit('conversation:member-removed', {
                    conversationId,
                    removedMemberId,
                    removerId,
                });
                server.to(userRoom).emit('conversation:member-removed', {
                    conversationId,
                    removedMemberId,
                    removerId,
                });
            },
        );

        this.conversationService.conversationGroupCreated$.subscribe(
            ({ conversationId, memberIds }) => {
                memberIds.forEach((memberId) => {
                    server
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
                    server.to(getRoomNameUser(memberId)).emit(
                        'conversation:restored',
                        {
                            conversationId,
                        },
                    );
                });
            },
        });

        this.messageService.updatedMessage$.subscribe({
            next: (message) => {
                server
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
                server.to(roomName).emit('conversation:name-changed', {
                    conversationId,
                    name,
                });
            },
        );

        this.conversationService.conversationAdminChanged$.subscribe(
            ({ conversationId, newAdminId, membersOnline }) => {
                membersOnline.forEach((memberId) => {
                    server
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
                server.to(roomName).emit('chat:new-message', message);
            },
        });

        this.messageService.pinnedMessage$.subscribe({
            next: ({ conversationId, messageId }) => {
                const payload: PinMessageEventPayload = {
                    conversationId,
                    messageId,
                };
                server
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
                server
                    .to(getRoomNameConversation(conversationId))
                    .emit('message:unpinned', payload);
            },
        });

        this.messageService.unseenMessage$.subscribe({
            next: ({ conversationId, userIds }) => {
                userIds.forEach((userId) => {
                    server.to(getRoomNameUser(userId)).emit(
                        'user:unseen-message',
                        {
                            conversationId,
                        },
                    );
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
                        server.to(roomName).emit('user:disabled', { userId });
                    });
                }

                // Also emit to the user's personal room so their own clients can log out
                server.to(getRoomNameUser(userId)).emit('user:disabled', {
                    userId,
                });

                // Force disconnect all sockets of this user
                server.in(getRoomNameUser(userId)).disconnectSockets(true);
            } catch (error) {
                console.log('Error user disabled event:', error);
            }
        });

        this.relationshipsService.relationshipCreated$.subscribe(
            ({ recipientId }) => {
                const payload: RelationshipCreatedPayload = { recipientId };
                server
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
                    server
                        .to(getRoomNameUser(userId))
                        .emit('relationship:accepted', payload);
                });
            },
        );

        this.relationshipsService.relationshipDeleted$.subscribe(
            ({ targetUserId }) => {
                const payload: RelationshipDeletedPayload = { targetUserId };
                server
                    .to(getRoomNameUser(targetUserId))
                    .emit('relationship:deleted', payload);
            },
        );

        this.relationshipsService.relationshipBlocked$.subscribe(
            ({ targetUserId }) => {
                const payload: RelationshipBlockedPayload = { targetUserId };
                server
                    .to(getRoomNameUser(targetUserId))
                    .emit('relationship:blocked', payload);
            },
        );

        this.relationshipsService.relationshipUnblocked$.subscribe(
            ({ targetUserId }) => {
                const payload = { targetUserId };
                server
                    .to(getRoomNameUser(targetUserId))
                    .emit('relationship:unblocked', payload);
            },
        );
    }
}
