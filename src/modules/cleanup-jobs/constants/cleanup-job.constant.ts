export const CLEANUP_JOB_CONSTANTS = {
    DEFAULT_RETRY_COUNT: 0,
    DEFAULT_MAX_RETRIES: 5,
} as const;

export const CLEANUP_JOB_MESSAGES = {
    FAILED_TO_CREATE_CLEANUP_JOB: 'Failed to create cleanup job',
    JOB_CREATED_SUCCESS: 'Cleanup job created successfully',
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
} as const;
