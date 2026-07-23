/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-misused-promises */
import { RedisService } from '@/redis/redis.service';
import {
    getRoomNameConversation,
    getRoomNameUser,
    logCatch,
} from '@/utils/utils';
import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { ConversationsService } from '../conversations/conversations.service';
import { MessagesService } from '../messages/messages.service';
import { RelationshipsService } from '../relationships/relationships.service';
import { UsersService } from '../users/users.service';
import { SOCKET_EVENTS } from './constants/realtime.constant';
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
    private readonly logger = new Logger(RealtimeEventBridgeService.name);

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
                        server
                            .to(roomName)
                            .emit(SOCKET_EVENTS.USER_OFFLINE, userOffline);
                    });
                }
                await this.usersService.setLastOnline(userId);
            } catch (error) {
                logCatch(this.logger, 'Error user offline', error);
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
                    const blockedRooms = await this.getBlockedUserRooms(
                        conversationId,
                        userId,
                    );
                    server
                        .to(roomName)
                        .except(blockedRooms)
                        .emit(SOCKET_EVENTS.USER_TYPING_UPDATE, typingData);
                } catch (error) {
                    logCatch(this.logger, 'Error user typing stop', error);
                }
            },
        );

        this.conversationService.conversationDisbanded$.subscribe(
            ({ conversationId, memberIds }) => {
                memberIds.forEach((memberId) => {
                    server
                        .to(getRoomNameUser(memberId))
                        .emit(SOCKET_EVENTS.CONVERSATION_DISBANDED, {
                            conversationId,
                        });
                });
            },
        );

        this.conversationService.memberAdded$.subscribe(
            ({ conversationId, addedMemberIds, adderId }) => {
                const roomName = getRoomNameConversation(conversationId);
                server
                    .to(roomName)
                    .emit(SOCKET_EVENTS.CONVERSATION_MEMBER_ADDED, {
                        conversationId,
                        addedMemberIds,
                        adderId,
                    });
                addedMemberIds.forEach((memberId) => {
                    server
                        .to(getRoomNameUser(memberId))
                        .emit(SOCKET_EVENTS.CONVERSATION_MEMBER_ADDED, {
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
                server
                    .to(roomName)
                    .emit(SOCKET_EVENTS.CONVERSATION_MEMBER_REMOVED, {
                        conversationId,
                        removedMemberId,
                        removerId,
                    });
                server
                    .to(userRoom)
                    .emit(SOCKET_EVENTS.CONVERSATION_MEMBER_REMOVED, {
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
                        .emit(SOCKET_EVENTS.CONVERSATION_GROUP_CREATED, {
                            conversationId,
                        });
                });
            },
        );

        this.messageService.restoredConversation$.subscribe({
            next: ({ conversationId, members }) => {
                members.forEach((memberId) => {
                    server
                        .to(getRoomNameUser(memberId))
                        .emit(SOCKET_EVENTS.CONVERSATION_RESTORED, {
                            conversationId,
                        });
                });
            },
        });

        this.messageService.updatedMessage$.subscribe({
            next: async (message) => {
                try {
                    const conversationId = message.conversationId.toString();
                    const blockedRooms = await this.getBlockedUserRooms(
                        conversationId,
                        this.getSenderId(message),
                    );
                    server
                        .to(getRoomNameConversation(conversationId))
                        .except(blockedRooms)
                        .emit(SOCKET_EVENTS.MESSAGE_UPDATED, message);
                } catch (error) {
                    logCatch(this.logger, 'Error message updated', error);
                }
            },
        });

        this.conversationService.conversationNameChanged$.subscribe(
            ({ conversationId, name }) => {
                const roomName = getRoomNameConversation(conversationId);
                server
                    .to(roomName)
                    .emit(SOCKET_EVENTS.CONVERSATION_NAME_CHANGED, {
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
                        .emit(SOCKET_EVENTS.CONVERSATION_ADMIN_CHANGED, {
                            conversationId,
                            newAdminId,
                        });
                });
            },
        );

        this.messageService.createdMessage$.subscribe({
            next: async (message) => {
                try {
                    const conversationId = message.conversationId.toString();
                    const roomName = getRoomNameConversation(conversationId);
                    const blockedRooms = await this.getBlockedUserRooms(
                        conversationId,
                        this.getSenderId(message),
                    );
                    server
                        .to(roomName)
                        .except(blockedRooms)
                        .emit(SOCKET_EVENTS.CHAT_NEW_MESSAGE, message);
                } catch (error) {
                    logCatch(this.logger, 'Error message created', error);
                }
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
                    .emit(SOCKET_EVENTS.MESSAGE_PINNED, payload);
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
                    .emit(SOCKET_EVENTS.MESSAGE_UNPINNED, payload);
            },
        });

        this.messageService.unseenMessage$.subscribe({
            next: ({ conversationId, userIds }) => {
                userIds.forEach((userId) => {
                    server
                        .to(getRoomNameUser(userId))
                        .emit(SOCKET_EVENTS.USER_UNSEEN_MESSAGE, {
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
                        server
                            .to(roomName)
                            .emit(SOCKET_EVENTS.USER_DISABLED, { userId });
                    });
                }

                // Also emit to the user's personal room so their own clients can log out
                server
                    .to(getRoomNameUser(userId))
                    .emit(SOCKET_EVENTS.USER_DISABLED, {
                        userId,
                    });

                // Force disconnect all sockets of this user
                server.in(getRoomNameUser(userId)).disconnectSockets(true);
            } catch (error) {
                logCatch(this.logger, 'Error user disabled event', error);
            }
        });

        this.relationshipsService.relationshipCreated$.subscribe(
            ({ recipientId }) => {
                const payload: RelationshipCreatedPayload = { recipientId };
                server
                    .to(getRoomNameUser(recipientId))
                    .emit(SOCKET_EVENTS.RELATIONSHIP_CREATED, payload);
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
                        .emit(SOCKET_EVENTS.RELATIONSHIP_ACCEPTED, payload);
                });
            },
        );

        this.relationshipsService.relationshipDeleted$.subscribe(
            ({ targetUserId }) => {
                const payload: RelationshipDeletedPayload = { targetUserId };
                server
                    .to(getRoomNameUser(targetUserId))
                    .emit(SOCKET_EVENTS.RELATIONSHIP_DELETED, payload);
            },
        );

        this.relationshipsService.relationshipBlocked$.subscribe(
            ({ targetUserId, actorId }) => {
                const payload: RelationshipBlockedPayload = {
                    targetUserId,
                    actorId,
                };
                server
                    .to(getRoomNameUser(targetUserId))
                    .emit(SOCKET_EVENTS.RELATIONSHIP_BLOCKED, payload);
            },
        );

        this.relationshipsService.relationshipUnblocked$.subscribe(
            ({ targetUserId, actorId }) => {
                const payload: RelationshipBlockedPayload = {
                    targetUserId,
                    actorId,
                };
                server
                    .to(getRoomNameUser(targetUserId))
                    .emit(SOCKET_EVENTS.RELATIONSHIP_UNBLOCKED, payload);
            },
        );
    }

    /**
     * Lấy id người tạo sự kiện (sender) từ message đã serialize.
     */
    private getSenderId(message: any): string | undefined {
        const sender = message?.sender;
        if (sender && typeof sender === 'object' && '_id' in sender) {
            return sender._id?.toString();
        }
        return sender?.toString?.();
    }

    /**
     * Trả về danh sách room cá nhân của những thành viên đang chặn `actorId`,
     * dùng để loại họ khỏi broadcast bằng `.except()`.
     */
    private async getBlockedUserRooms(
        conversationId: string,
        actorId?: string,
    ): Promise<string[]> {
        if (!actorId) {
            return [];
        }
        const { conversation } =
            await this.conversationService.getConversationOrThrow(
                conversationId,
            );
        const blockedUserIds =
            await this.relationshipsService.getBlockedUserIdsAmongUsers(
                actorId,
                conversation.users.map((user) => user.toString()),
            );
        return blockedUserIds.map((userId) => getRoomNameUser(userId));
    }
}
