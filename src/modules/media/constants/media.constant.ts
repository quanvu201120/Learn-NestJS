export const MEDIA_CONSTANTS = {
    USER_AVATAR_FOLDER: 'users/avatars',
    CONVERSATION_AVATAR_FOLDER: 'conversations/avatars',
    CONVERSATION_IMAGE_FOLDER: 'conversations/images',
    CONVERSATION_VIDEO_FOLDER: 'conversations/videos',
    CONVERSATION_AUDIO_FOLDER: 'conversations/audio',
    CONVERSATION_FILE_FOLDER: 'conversations/files',
    REPORT_EVIDENCE_FOLDER: 'reports/evidence',
} as const;

export const MEDIA_MESSAGES = {
    FILE_UPLOAD_OVER_LIMIT: 'File upload limit exceeded.',
    FILE_UPLOAD_EMPTY: 'Please upload at least one file',
    FILE_UPLOAD_FAILED: 'File upload failed',
    FILE_IS_TOO_LARGE: 'File is too large',
    WRONG_FILE_TYPE: 'Wrong file type',
    FILE_NOT_FOUND: 'File not found',
    MEDIA_CREATE_FAILED: 'Media creation failed',
    MEDIA_NOT_FOUND: 'Media not found',
    MEDIA_ACCESS_DENIED: 'You do not have access to this media',
    MEDIA_CONTENT_NOT_FOUND: 'Media content not found',
    MEDIA_NOT_STORED_IN_R2: 'Media is not stored in R2',
    MEDIA_DELETE_FAILED: 'Media deletion failed',
    PUBLIC_ID_NOT_FOUND: 'Public ID not found',
    AVATAR_DELETE_FAILED: 'Avatar delete failed',
    OBJECT_KEY_NOT_FOUND: 'Object key not found',
} as const;
