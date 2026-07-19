export const CALL_MESSAGES = {
    CALL_NOT_FOUND: 'Cuộc gọi không tồn tại',
    CALL_FORBIDDEN: 'Bạn không có quyền thao tác với cuộc gọi này',
    USER_NOT_ALLOWED: 'Người dùng không được phép gọi',
    CALL_BUSY: 'Người dùng đang trong cuộc gọi khác',
    CALL_RATE_LIMITED: 'Bạn đã gọi quá nhiều lần, vui lòng thử lại sau 1 phút',
    ALREADY_ENDED: 'Cuộc gọi đã kết thúc',
    CALL_NOT_SUPPORT_GROUP: 'Cuộc gọi không được hỗ trợ nhóm',
} as const;

export const CALL_RATE_LIMIT_CONSTANT = {
    START_LIMIT_COUNT: 5,
    START_LIMIT_WINDOW_SECONDS: 60,
    START_LOCK_SECONDS: 60,
} as const;

export const CALL_HEARTBEAT_CONSTANT = {
    ACCEPT_HEARTBEAT_TTL_SECONDS: 60,
    ACCEPT_HEARTBEAT_INTERVAL_SECONDS: 25,
} as const;

export const CALL_PUSH_CONSTANT = {
    INCOMING_CALL_TITLE: 'Cuộc gọi đến',
    INCOMING_CALL_BODY: 'Bạn có một cuộc gọi mới trên HaloChat.',
} as const;
