export const AUTH_MESSAGES = {
    LOGIN_FAILED: 'Đăng nhập thất bại',
    REFRESH_TOKEN_NOT_FOUND: 'Không tìm thấy Refresh Token',
    USER_NOT_FOUND: 'Không tìm thấy người dùng',
    USER_DISABLED: 'Tài khoản đã bị vô hiệu hóa',
    INVALID_TOKEN: 'Token không hợp lệ',
    SESSION_NOT_FOUND: 'Không tìm thấy session',
    SESSION_REVOKED: 'Session đã bị thu hồi',
    SESSION_EXPIRED: 'Session đã hết hạn',
    INVALID_REFRESH_TOKEN: 'Refresh Token không hợp lệ',
    EXPIRED_REFRESH_TOKEN: 'Refresh Token đã hết hạn',
    LOGOUT_SUCCESS: 'Đăng xuất thành công',
    LOGOUT_ALL_SUCCESS: 'Đăng xuất toàn bộ thiết bị thành công',
    LOGOUT_ALL_FAILED: 'Đăng xuất toàn bộ thiết bị thất bại',
    TOKEN_VERSION_MISMATCH: 'Token version không hợp lệ',
    SESSION_USER_NOT_MATCH: 'Session không hợp lệ',
    MISSING_PERMISSION: 'Bạn không có quyền thực hiện thao tác này',
    ACCOUNT_BANNED_UNTIL: (time: string) =>
        `Tài khoản của bạn đã bị cấm đến ${time}`,
    INVALID_CREDENTIALS: 'Tài khoản hoặc mật khẩu không hợp lệ',
    ACCESS_TOKEN_INVALID: 'Access Token không hợp lệ',
    APPEAL_TOKEN_INVALID: 'Appeal Token không hợp lệ',
    LOGIN_TOO_MANY_ATTEMPTS: (minutes: number) =>
        `Bạn đã đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ${minutes} phút.`,
} as const;

/**
 * Chính sách chặn đăng nhập theo tài khoản (progressive lockout).
 * `WINDOW_SECONDS`: thời gian đếm số lần sai tích luỹ trên redis.
 * `STEPS`: mốc số lần sai -> thời gian chặn (giây), sắp xếp tăng dần theo threshold.
 */
export const LOGIN_FAIL_POLICY = {
    WINDOW_SECONDS: 15 * 60,
    STEPS: [
        { threshold: 5, blockSeconds: 60 },
        { threshold: 8, blockSeconds: 5 * 60 },
        { threshold: 12, blockSeconds: 15 * 60 },
        { threshold: 16, blockSeconds: 30 * 60 },
    ],
} as const;

export const THROTTLE_LIMITS = {
    ONE_MINUTE: 60 * 1000,
    GLOBAL_LIMIT: 500,
    AUTH_LIMIT_10: 10,
    AUTH_LIMIT_5: 5,
    MAIL_LIMIT: 1,
} as const;
