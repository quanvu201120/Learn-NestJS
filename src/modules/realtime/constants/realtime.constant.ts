export const REALTIME_MESSAGES = {
    MISSING_TOKEN: 'Thiếu token',
    USER_MUTED: (time: string) => `Bạn đã bị cấm chat đến ${time}`,
    UNKNOWN_ERROR: 'Lỗi không xác định',
    EVENT_RATE_LIMITED: (seconds: number) =>
        `Bạn thao tác quá nhanh, vui lòng thử lại sau ${seconds}s`,
} as const;

export const REALTIME_CONSTANT = {
    CALL_RING_TIMEOUT_MS: 30_000,
    METERED_ICE_EXPIRY_SECONDS: 3600, // thời gian sống của ICE servers
    ICE_SERVERS_ROTATE_THRESHOLD_SECONDS: 360, // thời gian còn lại an toàn để refresh ICE servers
    ICE_SERVERS_CACHE_KEY: 'webrtc:ice-servers',
} as const;

export const SOCKET_EVENT_RATE_LIMIT = {
    CREATE_MESSAGE: { limit: 20, windowSeconds: 10 },
    JOIN_CONVERSATION: { limit: 20, windowSeconds: 10 },
    TYPING: { limit: 20, windowSeconds: 10 },
    MARK_READ: { limit: 20, windowSeconds: 10 },
} as const;

export const REALTIME_EVENTS = {
    NOTIFICATION_CREATED: 'notification.created',
    USER_BANNED: 'user.banned',
    SESSION_REVOKED: 'session.revoked',
    SESSION_REVOKED_ALL: 'session.revoked-all',
    USER_MUTED: 'user.muted',
    USER_UNMUTED: 'user.unmuted',
} as const;

export const SOCKET_EVENTS = {
    USER_ONLINE: 'user:online',
    NOTIFICATION_CREATED: 'notification:created',
    USER_BANNED: 'user:banned',
    USER_SESSION_REVOKED: 'user:session-revoked',
    USER_MUTED: 'user:muted',
    USER_UNMUTED: 'user:unmuted',
    CHAT_JOIN_CONVERSATION: 'chat:join-conversation',
    CHAT_CREATE_MESSAGE: 'chat:create-message',
    USER_HEARTBEAT: 'user:heartbeat',
    CHAT_TYPING_START: 'chat:typing-start',
    CHAT_TYPING_STOP: 'chat:typing-stop',
    CHAT_MARK_READ: 'chat:mark-read',
    CHAT_DELETE_MESSAGE: 'chat:delete-message',
    CHAT_UPDATE_MESSAGE: 'chat:update-message',
    CALL_START: 'call:start',
    CALL_ACCEPT: 'call:accept',
    CALL_REJECT: 'call:reject',
    CALL_END: 'call:end',
    CALL_HEARTBEAT: 'call:heartbeat',
    CALL_SYNC: 'call:sync',
    CALL_OFFER: 'call:offer',
    CALL_ANSWER: 'call:answer',
    CALL_ICE_CANDIDATE: 'call:ice-candidate',
    CALL_ENDED: 'call:ended',
    CALL_INCOMING: 'call:incoming',
    CALL_ACCEPTED: 'call:accepted',
    CALL_CLOSE: 'call:close',
    CALL_REJECTED: 'call:rejected',
    USER_TYPING_UPDATE: 'user:typing-update',
    USER_MARK_READ: 'user:mark-read',
    USER_UNSEEN_CLEARED: 'user:unseen-cleared',
    CHAT_MESSAGE_DELETED: 'chat:message-deleted',
    USER_OFFLINE: 'user:offline',
    CONVERSATION_DISBANDED: 'conversation:disbanded',
    CONVERSATION_MEMBER_ADDED: 'conversation:member-added',
    CONVERSATION_MEMBER_REMOVED: 'conversation:member-removed',
    CONVERSATION_GROUP_CREATED: 'conversation:group-created',
    CONVERSATION_RESTORED: 'conversation:restored',
    MESSAGE_UPDATED: 'message:updated',
    CONVERSATION_NAME_CHANGED: 'conversation:name-changed',
    CONVERSATION_ADMIN_CHANGED: 'conversation:admin-changed',
    CHAT_NEW_MESSAGE: 'chat:new-message',
    MESSAGE_PINNED: 'message:pinned',
    MESSAGE_UNPINNED: 'message:unpinned',
    USER_UNSEEN_MESSAGE: 'user:unseen-message',
    USER_DISABLED: 'user:disabled',
    RELATIONSHIP_CREATED: 'relationship:created',
    RELATIONSHIP_ACCEPTED: 'relationship:accepted',
    RELATIONSHIP_DELETED: 'relationship:deleted',
    RELATIONSHIP_BLOCKED: 'relationship:blocked',
    RELATIONSHIP_UNBLOCKED: 'relationship:unblocked',
    WEBRTC_ICE_SERVERS_UPDATED: 'webrtc:ice-servers-updated',
} as const;
