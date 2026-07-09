export const STATS_CONSTANTS = {
    /** Số ngày mặc định khi lấy dữ liệu biểu đồ */
    DEFAULT_DAILY_LIMIT: 30,

    /** Biểu thức Cron: 23:59 mỗi đêm (để chốt sổ ngày/tháng trọn vẹn) */
    CRON_DAILY_MIDNIGHT: '59 23 * * *',
} as const;

export const SYSTEM_DAILY_STAT_SUM_FIELDS = [
    'newUsers',
    'logins',
    'newGroups',
    'newDirects',
    'messagesText',
    'messagesImage',
    'messagesVideo',
    'messagesFile',
    'messagesVoice',
    'uploadBytesCloudinary',
    'uploadBytesR2',
    'cloudinaryBandwidthBytes',
    'r2BandwidthBytes',
] as const;
export const STATS_MESSAGES = {
    CLOUD_USAGE_SYNC_START: 'Bắt đầu đồng bộ dữ liệu...',
    CLOUD_USAGE_SYNC_SUCCESS: 'Đồng bộ dữ liệu hoàn tất.',
    CLOUD_USAGE_SYNC_FAILED: 'Đồng bộ dữ liệu thất bại',
    CLOUDINARY_FETCH_FAILED: 'Lấy dữ liệu từ Cloudinary thất bại',
    R2_FETCH_FAILED: 'Lấy dữ liệu từ R2 thất bại',
    R2_CONFIG_MISSING:
        'Chưa cấu hình CLOUDFLARE_API_TOKEN hoặc CLOUDFLARE_ACCOUNT_ID',
} as const;
