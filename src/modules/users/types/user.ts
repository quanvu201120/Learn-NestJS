import { Types } from 'mongoose';
import { User } from '../schemas/user.schema';
import { Media } from '@/modules/media/schemas/media.schema';

export type UserResponse = Omit<User, 'password' | 'avatar'> & {
    _id: Types.ObjectId | string;
    createdAt?: Date;
    updatedAt?: Date;
    avatar?: Media | Types.ObjectId | string;
};

export type UserDisableStateResponse = {
    message: string;
    isDisabled: boolean;
};

export type CleanupJobStatus =
    | 'PENDING'
    | 'PROCESSING'
    | 'RETRY'
    | 'DONE'
    | 'FAILED'
    | 'IGNORED';

export type CleanupJobAction =
    | 'CLOUDINARY_DELETE_ONE'
    | 'CLOUDINARY_DELETE_MANY'
    | 'R2_DELETE_ONE'
    | 'R2_DELETE_MANY'
    | 'REDIS_REMOVE_UNSEEN_ONE'
    | 'REDIS_REMOVE_UNSEEN_MANY'
    | 'SESSION_REVOKE'
    | 'SESSION_REVOKE_ALL';

export type CleanupJobResourceType =
    | 'USER_AVATAR'
    | 'CONVERSATION_AVATAR'
    | 'MESSAGE_MEDIA'
    | 'CONVERSATION_MEDIA'
    | 'UNSEEN_CONVERSATION'
    | 'SESSION';
