import { MessageResponse } from '@/modules/messages/types/message';

export type SocketResponse<T = any> = {
    ok: boolean;
    message?: string;
    data?: T;
    retryAfterSeconds?: number;
};

// --- ACK RESPONSE DATA ---
export type JoinConversationResult = {
    conversationId: string;
    roomName: string;
    joined: boolean;
    membersOnline: string[];
};

export type CreateMessageResult = {
    created: boolean;
    message: MessageResponse;
};

export type HeartbeatResult = {
    setPresence: boolean;
};

export type TypingResult = {
    setTyping: boolean;
};

export type MarkReadResult = {
    markRead: boolean;
};

export type SoftDeleteMessageResult = {
    deleted: boolean;
};

export type UpdateMessageResult = {
    updated: boolean;
    messageId: string;
};

export type CallAckResult = {
    callId: string;
    conversationId: string;
    callToken?: string;
};

export type SignalAckResult = {
    forwarded: boolean;
};

export type CallHeartbeatResult = {
    refreshed: boolean;
};

export type CallSyncResult = {
    hasActiveCall: boolean;
    callId?: string;
    callerId?: string;
    calleeId?: string;
    conversationId?: string;
    callType?: string;
    callToken?: string;
    createdAt?: Date;
};

// --- BROADCAST EVENT PAYLOADS ---
export type CallTokenPayload = {
    callId: string;
    conversationId: string;
    callerId: string;
    calleeId: string;
};

export type TypingEventPayload = {
    conversationId: string;
    userId: string;
    typing: boolean;
};

export type MarkReadEventPayload = {
    conversationId: string;
    userId: string;
    messageId: string;
};

export type UserOnlinePayload = {
    userId: string;
};

export type UserOfflinePayload = {
    userId: string;
    lastOnlineAt: Date;
};

export type SoftDeleteMessagePayload = {
    conversationId: string;
    messageId: string;
    deletedBy: string;
};

export type RelationshipCreatedPayload = {
    recipientId: string;
};

export type RelationshipAcceptedPayload = {
    userIds: string[];
};

export type RelationshipDeletedPayload = {
    targetUserId: string;
};

export type RelationshipBlockedPayload = {
    targetUserId: string;
    actorId: string;
};

export type PinMessageEventPayload = {
    conversationId: string;
    messageId: string;
};
export type UnpinMessageEventPayload = {
    conversationId: string;
    messageId: string;
};
