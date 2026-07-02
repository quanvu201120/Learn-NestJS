export type ActionRedis = 'NEW' | 'RESEND' | 'FORGOT' | 'UPDATE_EMAIL';

export const GLOBAL_CONSTANTS = {
    COOLDOWN_SECONDS: 60,
    LIMIT_MESSAGES_DEFAULT: 20,
    LIMIT_CONVERSATIONS_DEFAULT: 20,
    LIMIT_MEDIAS_DEFAULT: 10,
    LIMIT_USERS_DEFAULT: 20,
    SALT_BCRYPT: 10,
    HEARTBEAT_INTERVAL: 120, //seconds
} as const;

export const GLOBAL_MESSAGES = {
    INVALID_FIELD: (fieldName: string) => `Invalid ${fieldName}`,
    UNKNOWN_DEVICE: 'Unknown device',
} as const;
