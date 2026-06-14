export const MEDIA_CONSTANTS = {
    USER_AVATAR_FOLDER: 'users/avatar',
    CONVERSATION_AVATAR_FOLDER: 'conversations/avatar',
    CONVERSATION_IMAGE_FOLDER: 'conversations/images',
    CONVERSATION_VIDEO_FOLDER: 'conversations/videos',
    CONVERSATION_AUDIO_FOLDER: 'conversations/audio',
    CONVERSATION_FILE_FOLDER: 'conversations/file',
} as const;

export const MEDIA_MESSAGES = {
    FILE_UPLOAD_FAILED: 'File upload failed',
    FILE_IS_TOO_LARGE: 'File is too large',
    WRONG_FILE_TYPE: 'Wrong file type',
    FILE_NOT_FOUND: 'File not found',
    MEDIA_CREATE_FAILED: 'Media creation failed',
    MEDIA_NOT_FOUND: 'Media not found',
    MEDIA_DELETE_FAILED: 'Media deletion failed',
    PUBLIC_ID_NOT_FOUND: 'Public ID not found',
    AVATAR_DELETE_FAILED: 'Avatar delete failed',
    OBJECT_KEY_NOT_FOUND: 'Object key not found',
} as const;
