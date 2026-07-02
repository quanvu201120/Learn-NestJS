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
    CLOUD_USAGE_SYNC_START: 'Starting daily cloud usage sync...',
    CLOUD_USAGE_SYNC_SUCCESS: 'Cloud usage sync completed successfully.',
    CLOUD_USAGE_SYNC_FAILED: 'Failed to upsert monthly cloud usage',
    CLOUDINARY_FETCH_FAILED: 'Failed to fetch Cloudinary usage',
    R2_FETCH_FAILED: 'Failed to fetch R2 usage',
    R2_CONFIG_MISSING:
        'CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID not configured, skipping R2 usage fetch.',
} as const;
