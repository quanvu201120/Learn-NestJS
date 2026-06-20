import { CleanupJobActionEnum } from '../types/cleanup-job';

export const CLEANUP_JOB_CONSTANTS = {
    DEFAULT_RETRY_COUNT: 0,
    DEFAULT_MAX_RETRIES: 10,
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 20,
    LOCK_DURATION_MS: 10 * 60 * 1000,
} as const;

export const CLEANUP_JOB_MESSAGES = {
    FAILED_TO_CREATE_CLEANUP_JOB: 'Failed to create cleanup job',
    JOB_CREATED_SUCCESS: 'Cleanup job created successfully',
    JOB_NOT_FOUND_OR_LOCKED: 'Cleanup job not found or locked',
    JOB_NOT_FOUND: 'Cleanup job not found',
    JOB_INVALID_PAYLOAD: 'Cleanup job payload is invalid',
    JOB_ALREADY_RESOLVED: 'Cleanup job has already been resolved',
    JOB_MARKED_RETRY: 'Cleanup job marked for retry',
    JOB_MARKED_DONE: 'Cleanup job completed successfully',
    JOB_MARKED_FAILED: 'Cleanup job failed',
    JOB_MARKED_IGNORED: 'Cleanup job ignored',
    JOB_RETRY_LIMIT_REACHED: 'Cleanup job retry limit reached',
    JOB_NEXT_RETRY_REQUIRED: 'Next retry time is required for retry status',
    JOB_ERROR_REQUIRED: 'Error message is required for failed status',
    FAILED_TO_UPDATE_JOB: 'Failed to update job',

    JOB_INVALID_PAYLOAD_PUBLIC_ID: 'Public ID is required',
    JOB_INVALID_PAYLOAD_PUBLIC_IDS: 'Public IDs is required',
    JOB_INVALID_PAYLOAD_OBJECT_KEY: 'Object key is required',
    JOB_INVALID_PAYLOAD_OBJECT_KEYS: 'Object keys is required',
    JOB_INVALID_PAYLOAD_USER_ID: 'User ID is required',
    JOB_INVALID_PAYLOAD_USER_IDS: 'User IDs is required',
    JOB_INVALID_PAYLOAD_CONVERSATION_ID: 'Conversation ID is required',
    JOB_INVALID_PAYLOAD_SESSION_ID: 'Session ID is required',
    JOB_ACTION_NOT_SUPPORTED: 'Action not supported',

    FAILED_TO_DELETE_IMAGE_FROM_CLOUDINARY:
        'Failed to delete image from cloudinary',
    FAILED_TO_DELETE_IMAGES_FROM_CLOUDINARY:
        'Failed to delete images from cloudinary',
    FAILED_TO_DELETE_OBJECT_FROM_R2: 'Failed to delete object from R2',
    FAILED_TO_DELETE_OBJECTS_FROM_R2: 'Failed to delete objects from R2',
    FAILED_TO_REMOVE_UNSEEN_FROM_REDIS: 'Failed to remove unseen from redis',
    FAILED_TO_REMOVE_UNSEENS_FROM_REDIS: 'Failed to remove unseens from redis',
    FAILED_TO_REVOKE_SESSION: 'Failed to revoke session',
    FAILED_TO_REVOKE_SESSIONS: 'Failed to revoke sessions',

    GET_JOB_PAGINATION_INVALID: 'Page or limit is invalid',
} as const;

const MEDIA_RETRY_DELAYS = [
    10, 30, 60, 240, 720, 1440, 2880, 4320, 5760, 10080,
];
const REDIS_RETRY_DELAYS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const SESSION_RETRY_DELAYS = Array(10).fill(10);

/** Mảng delay cho các lần retry, tối đa 10 lần tương ứng với:
 * Media: 10m, 30m, 1h, 4h, 12h, 24h, 2d, 3d, 4d, 7d
 * Redis: 10m, 20m, 30m, 40m, 50m, 60m, 70m, 80m, 90m, 100m
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
