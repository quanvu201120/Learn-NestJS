export const REPORT_MESSAGES = {
    CANNOT_REPORT_SELF: 'Bạn không thể báo cáo chính mình',
    TOO_MANY_REPORTS: 'Bạn đã báo cáo người dùng này quá nhiều lần trong ngày',
    TARGET_USER_NOT_FOUND: 'Người dùng bị báo cáo không tồn tại',
    REPORT_SUBMITTED_SUCCESS: 'Gửi báo cáo thành công',
    REPORT_NOT_FOUND: 'Không tìm thấy báo cáo',
    ADMIN_NOT_FOUND: 'Không tìm thấy quản trị viên',
    MEDIA_INVALID_FOR_REPORT: 'Tệp đính kèm không hợp lệ',
    MISSING_PERMISSION: 'Bạn không có quyền thực hiện thao tác này',
    CANNOT_PENALIZE_SELF: 'Bạn không thể xử lý chính mình',
    INVALID_PASSWORD: 'Mật khẩu không hợp lệ',
    CANNOT_PENALIZE_USER: 'Bạn không có quyền xử lý người dùng này',
    CANNOT_PENALIZE_SUPER_ADMIN: 'Bạn không có quyền xử lý Super Admin',
    CANNOT_REDUCE_PENALTY: 'Không thể áp dụng mức phạt thấp hơn mức đang có',
    NO_AUTO_PENALTY: 'Không có hình phạt cụ thể',
    WARNING_SENT: 'Cảnh cáo',
    REPORT_INVALID_STATUS: 'Trạng thái báo cáo không hợp lệ',
    APPEAL_DEADLINE_EXPIRED: 'Đã hết hạn kháng cáo',
    MUTE_APPLIED: (duration: number, until: string) =>
        `Cấm chat ${duration} ngày (đến ${until})`,
    RESET_AND_WARNING: 'Xóa dữ liệu và Cảnh cáo',
    RESET_AND_BAN: (duration: number, until: string) =>
        `Xóa dữ liệu và Khóa tài khoản ${duration} ngày (đến ${until})`,
    BAN_APPLIED: (duration: number, until: string) =>
        `Khóa tài khoản ${duration} ngày (đến ${until})`,
    REPORT_ALREADY_RESOLVED: 'Báo cáo này đã được xử lý',
    REPORT_IS_BEING_PROCESSED: 'Báo cáo đang được xử lý',
    REPORT_RESOLVED_SUCCESS: 'Xử lý báo cáo thành công',
    QUICK_PENALTY_DESC: 'Xử lý vi phạm nhanh bởi Quản trị viên',
    QUICK_PENALTY_NOTE: 'Xử lý vi phạm nhanh',
    MANUAL_BAN_DESC: 'Khóa tài khoản thủ công bởi Quản trị viên',
    USER_NOT_FOUND: 'Không tìm thấy người dùng',
    UNBAN_SUCCESS: 'Mở khóa tài khoản thành công',
    APPEAL_SUCCESS: (reason: string) => `Kháng cáo thành công: ${reason}`,
    ADMIN_UNBAN_NOTE: (reason: string) =>
        `Admin mở khóa tài khoản, lí do: ${reason}`,
    ADMIN_UNMUTE_NOTE: (reason: string) =>
        `Admin gỡ cấm chat, lí do: ${reason}`,
    ADMIN_CLEAR_STRIKE_NOTE: (reason: string) =>
        `Admin xóa án tích, lí do: ${reason}`,
    UNMUTE_SUCCESS: 'Dỡ bỏ lệnh cấm chat',
    STRIKE_CLEARED_SUCCESS: 'Xóa án tích thành công',
    SUPER_ADMIN_DISMISS_NOTE: 'Bỏ qua báo cáo SUPER_ADMIN',
    MERGED_REPORT_NOTE: (reportId: string) =>
        `Đã xử lý gộp chung với báo cáo #${reportId}`,
    SYSTEM_BAN_SPAM_DESCRIPTION: 'Auto ban: Spam hệ thống',
} as const;

export const REPORT_CONSTANTS = {
    REPORT_LIMIT_PER_DAY_DEFAULT: 3,
};
