export const REALTIME_MESSAGES = {
    MISSING_TOKEN: 'Thiếu token',
    USER_MUTED: (time: string) => `Bạn đã bị cấm chat đến ${time}`,
    UNKNOWN_ERROR: 'Lỗi không xác định',
} as const;

export const REALTIME_CONSTANT = {
    CALL_RING_TIMEOUT_MS: 30_000,
} as const;
