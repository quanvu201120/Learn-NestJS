export const REALTIME_MESSAGES = {
    MISSING_TOKEN: 'Missing token',
    USER_MUTED: (time: string) => `Your account has been muted until ${time}`,
} as const;
