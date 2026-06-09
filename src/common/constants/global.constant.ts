export type ActionRedis = 'NEW' | 'RESEND' | 'FORGOT';

export const GLOBAL_CONSTANTS = {
    COOLDOWN_SECONDS: 60,
    LIMIT_MESSAGES_DEFAULT: 20,
    SALT_BCRYPT: 10,
} as const;

export const GLOBAL_MESSAGES = {
    INVALID_FIELD: (fieldName: string) => `Invalid ${fieldName}`,
    UNKNOWN_DEVICE: 'Unknown device',
} as const;
