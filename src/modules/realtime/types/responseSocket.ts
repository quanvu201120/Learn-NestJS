export type SocketResponse<T = any> = {
    ok: boolean;
    message?: string;
    data?: T;
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
    messageId: string;
    conversationId: string;
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

// --- BROADCAST EVENT PAYLOADS ---
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
