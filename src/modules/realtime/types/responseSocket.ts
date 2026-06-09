export type SocketResponse<T = any> = {
    ok: boolean;
    message?: string;
    data?: T;
};

export type JoinConversationEvent = {
    conversationId: string;
    roomName: string;
    joined: boolean;
    membersOnline: string[];
};

export type CreatedMessageEvent = {
    created: boolean;
    messageId: string;
    conversationId: string;
};

export type TypingUpdateEvent = {
    conversationId: string;
    userId: string;
    typing: boolean;
};
