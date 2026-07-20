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
} as const;

export const THROTTLE_LIMITS = {
    ONE_MINUTE: 60 * 1000,
    GLOBAL_LIMIT: 500,
    AUTH_LIMIT: 10,
    MAIL_LIMIT: 1,
} as const;
