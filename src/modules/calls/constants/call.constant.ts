export const CALL_MESSAGES = {
    CALL_NOT_FOUND: 'Cuộc gọi không tồn tại',
    CALL_FORBIDDEN: 'Bạn không có quyền thao tác với cuộc gọi này',
    USER_NOT_ALLOWED: 'Người dùng không được phép gọi',
    CALL_BUSY: 'Người dùng đang trong cuộc gọi khác',
    CALL_RATE_LIMITED: 'Bạn đã gọi quá nhiều lần, vui lòng thử lại sau 1 phút',
    ALREADY_ENDED: 'Cuộc gọi đã kết thúc',
} as const;

export const CALL_RATE_LIMIT_CONSTANT = {
    START_LIMIT_COUNT: 5,
    START_LIMIT_WINDOW_SECONDS: 60,
    START_LOCK_SECONDS: 60,
} as const;
