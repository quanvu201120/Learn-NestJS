export const REALTIME_MESSAGES = {
    MISSING_TOKEN: 'Thiếu token',
    USER_MUTED: (time: string) => `Bạn đã bị cấm chat đến ${time}`,
    UNKNOWN_ERROR: 'Lỗi không xác định',
} as const;
