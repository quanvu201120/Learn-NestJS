import { CleanupJob } from '../schemas/cleanup-job.schema';

export enum CleanupJobStatusEnum {
    PENDING = 'PENDING',
    RETRY = 'RETRY',
    DONE = 'DONE',
    FAILED = 'FAILED',
    IGNORED = 'IGNORED',
}

export enum CleanupJobActionEnum {
    CLOUDINARY_DELETE_ONE = 'CLOUDINARY_DELETE_ONE',
    CLOUDINARY_DELETE_MANY = 'CLOUDINARY_DELETE_MANY',
    R2_DELETE_ONE = 'R2_DELETE_ONE',
    R2_DELETE_MANY = 'R2_DELETE_MANY',
    REDIS_REMOVE_UNSEEN_ONE = 'REDIS_REMOVE_UNSEEN_ONE',
    REDIS_REMOVE_UNSEEN_MANY = 'REDIS_REMOVE_UNSEEN_MANY',
    SESSION_REVOKE = 'SESSION_REVOKE',
    SESSION_REVOKE_ALL = 'SESSION_REVOKE_ALL',
}

export enum CleanupJobResourceEnum {
    USER_AVATAR = 'USER_AVATAR',
    CONVERSATION_AVATAR = 'CONVERSATION_AVATAR',
    MESSAGE_MEDIA = 'MESSAGE_MEDIA',
    CONVERSATION_MEDIA = 'CONVERSATION_MEDIA',
    UNSEEN_CONVERSATION = 'UNSEEN_CONVERSATION',
    SESSION = 'SESSION',
}

export enum CleanupJobEntityEnum {
    CONVERSATION = 'CONVERSATION',
    MESSAGE = 'MESSAGE',
    USER = 'USER',
}

export enum CleanupJobLockedBy {
    ADMIN = 'ADMIN',
    WORKER = 'WORKER',
}

export type CleanupJobRespone = {
    cleanupJobs: CleanupJob[];
    pagination: {
        totalItems: number;
        totalPages: number;
        currentPage: number;
        limit: number;
    };
};
