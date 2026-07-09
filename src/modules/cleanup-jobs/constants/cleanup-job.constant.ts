import { CleanupJobActionEnum } from '../types/cleanup-job';

export const CLEANUP_JOB_CONSTANTS = {
    DEFAULT_RETRY_COUNT: 0,
    DEFAULT_MAX_RETRIES: 9,
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 20,
    LOCK_DURATION_MS: 10 * 60 * 1000,
} as const;

export const CLEANUP_JOB_MESSAGES = {
    FAILED_TO_CREATE_CLEANUP_JOB: 'Tạo cleanup-job thất bại',
    JOB_CREATED_SUCCESS: 'Tạo cleanup-job thành công',
    JOB_NOT_FOUND_OR_LOCKED: 'Không tìm thấy cleanup-job hoặc job đang bị khóa',
    JOB_NOT_FOUND: 'Không tìm thấy cleanup-job',
    JOB_INVALID_PAYLOAD: 'Payload của cleanup-job không hợp lệ',
    JOB_ALREADY_RESOLVED: 'Cleanup-job đã được xử lý',
    FAILED_TO_UPDATE_JOB: 'Cập nhật cleanup-job thất bại',

    JOB_INVALID_PAYLOAD_PUBLIC_ID: 'Public ID là bắt buộc',
    JOB_INVALID_PAYLOAD_PUBLIC_IDS: 'Danh sách Public ID là bắt buộc',
    JOB_INVALID_PAYLOAD_OBJECT_KEY: 'Object key là bắt buộc',
    JOB_INVALID_PAYLOAD_OBJECT_KEYS: 'Danh sách Object key là bắt buộc',
    JOB_INVALID_PAYLOAD_USER_ID: 'User ID là bắt buộc',
    JOB_INVALID_PAYLOAD_USER_IDS: 'Danh sách User ID là bắt buộc',
    JOB_INVALID_PAYLOAD_CONVERSATION_ID: 'Conversation ID là bắt buộc',
    JOB_INVALID_PAYLOAD_SESSION_ID: 'Session ID là bắt buộc',
    JOB_ACTION_NOT_SUPPORTED: 'Hành động này không được hỗ trợ',

    FAILED_TO_DELETE_IMAGE_FROM_CLOUDINARY: 'Xóa ảnh trên Cloudinary thất bại',
    FAILED_TO_DELETE_IMAGES_FROM_CLOUDINARY:
        'Xóa danh sách ảnh trên Cloudinary thất bại',
    FAILED_TO_DELETE_OBJECT_FROM_R2: 'Xóa object trên R2 thất bại',
    FAILED_TO_DELETE_OBJECTS_FROM_R2: 'Xóa danh sách object trên R2 thất bại',
    FAILED_TO_REMOVE_UNSEEN_FROM_REDIS: 'Xóa unseen trong Redis thất bại',
    FAILED_TO_REMOVE_UNSEENS_FROM_REDIS:
        'Xóa danh sách unseen trong Redis thất bại',
    FAILED_TO_REVOKE_SESSION: 'Thu hồi session thất bại',
    FAILED_TO_REVOKE_SESSIONS: 'Thu hồi danh sách session thất bại',

    GET_CLEANUP_JOBS_PAGINATION_INVALID: 'Page và limit phải lớn hơn 0',
    FILE_REQUIRED: 'Vui lòng tải lên tệp',
    STATUS_NOT_SUPPORTED: 'Trạng thái này không được hỗ trợ',
    MANUAL_TEST_CLEANUP_JOB_CLOUDINARY:
        'Cleanup job kiểm thử thủ công cho Cloudinary',
    MANUAL_TEST_CLEANUP_JOB_R2: 'Cleanup job kiểm thử thủ công cho R2',
    UNKNOWN_ERROR: 'Lỗi không xác định',
} as const;

const MEDIA_RETRY_DELAYS = [30, 60, 240, 720, 1440, 2880, 4320, 5760, 10080];
const REDIS_RETRY_DELAYS = [20, 30, 40, 50, 60, 70, 80, 90, 100];
const SESSION_RETRY_DELAYS = Array(1008).fill(10); // Đủ retry 10p/lần trong 7 ngày

/** Mảng delay cho các lần retry, tối đa 9 lần tương ứng với:
 * Media: 30m, 1h, 4h, 12h, 24h, 2d, 3d, 4d, 7d
 * Redis: 20m, 30m, 40m, 50m, 60m, 70m, 80m, 90m, 100m
 * Session: 10m liên tục cho đến khi refresh token hết hạn
 */
export const CLEANUP_RETRY_DELAYS_MINUTES: Record<
    CleanupJobActionEnum,
    number[]
> = {
    // Media (Cloudinary & R2)
    [CleanupJobActionEnum.CLOUDINARY_DELETE_ONE]: MEDIA_RETRY_DELAYS,
    [CleanupJobActionEnum.CLOUDINARY_DELETE_MANY]: MEDIA_RETRY_DELAYS,
    [CleanupJobActionEnum.R2_DELETE_ONE]: MEDIA_RETRY_DELAYS,
    [CleanupJobActionEnum.R2_DELETE_MANY]: MEDIA_RETRY_DELAYS,

    // Redis Unseen
    [CleanupJobActionEnum.REDIS_REMOVE_UNSEEN_ONE]: REDIS_RETRY_DELAYS,
    [CleanupJobActionEnum.REDIS_REMOVE_UNSEEN_MANY]: REDIS_RETRY_DELAYS,

    // Session Revoke
    [CleanupJobActionEnum.SESSION_REVOKE]: SESSION_RETRY_DELAYS,
    [CleanupJobActionEnum.SESSION_REVOKE_ALL]: SESSION_RETRY_DELAYS,
};

export const CLEANUP_MAX_RETRIES: Record<CleanupJobActionEnum, number> = {
    // Media (Cloudinary & R2)
    [CleanupJobActionEnum.CLOUDINARY_DELETE_ONE]: MEDIA_RETRY_DELAYS.length,
    [CleanupJobActionEnum.CLOUDINARY_DELETE_MANY]: MEDIA_RETRY_DELAYS.length,
    [CleanupJobActionEnum.R2_DELETE_ONE]: MEDIA_RETRY_DELAYS.length,
    [CleanupJobActionEnum.R2_DELETE_MANY]: MEDIA_RETRY_DELAYS.length,

    // Redis Unseen
    [CleanupJobActionEnum.REDIS_REMOVE_UNSEEN_ONE]: REDIS_RETRY_DELAYS.length,
    [CleanupJobActionEnum.REDIS_REMOVE_UNSEEN_MANY]: REDIS_RETRY_DELAYS.length,

    // Session Revoke
    [CleanupJobActionEnum.SESSION_REVOKE]: SESSION_RETRY_DELAYS.length,
    [CleanupJobActionEnum.SESSION_REVOKE_ALL]: SESSION_RETRY_DELAYS.length,
};
