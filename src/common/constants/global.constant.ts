export type ActionRedis = 'NEW' | 'RESEND' | 'FORGOT' | 'UPDATE_EMAIL';

export const GLOBAL_CONSTANTS = {
    COOLDOWN_SECONDS: 60,
    LIMIT_MESSAGES_DEFAULT: 20,
    LIMIT_CONVERSATIONS_DEFAULT: 20,
    LIMIT_MEDIAS_DEFAULT: 10,
    LIMIT_NOTIFICATIONS_DEFAULT: 20,
    LIMIT_USERS_DEFAULT: 20,
    LIMIT_AUDIT_LOGS_DEFAULT: 20,
    LIMIT_REPORTS_DEFAULT: 20,
    LIMIT_AUDIT_LOGS_MAX: 100,
    LIMIT_REPORTS_MAX: 100,
    SALT_BCRYPT: 10,
    HEARTBEAT_INTERVAL: 120, //seconds
} as const;

export const GLOBAL_MESSAGES = {
    INVALID_FIELD: (fieldName: string) => `${fieldName} không hợp lệ`,
    UNKNOWN_DEVICE: 'Thiết bị không xác định',
    UNKNOWN_ERROR: 'Lỗi không xác định',
} as const;
