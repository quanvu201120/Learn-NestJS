export const MEDIA_CONSTANTS = {
    USER_AVATAR_FOLDER: 'users/avatar',
    GROUP_AVATAR_FOLDER: 'conversations/avatar',
    MESSAGE_IMAGE_FOLDER: 'messages/image',
    MESSAGE_VIDEO_FOLDER: 'messages/video',
    MESSAGE_AUDIO_FOLDER: 'messages/audio',
    MESSAGE_FILE_FOLDER: 'messages/file',
} as const;

export const MEDIA_MESSAGES = {
    FILE_UPLOAD_FAILED: 'File upload failed',
    FILE_IS_TOO_LARGE: 'File is too large',
    WRONG_FILE_TYPE: 'Wrong file type',
    FILE_NOT_FOUND: 'File not found',
    MEDIA_CREATE_FAILED: 'Media creation failed',
    MEDIA_NOT_FOUND: 'Media not found',
    MEDIA_DELETE_FAILED: 'Media deletion failed',
} as const;
