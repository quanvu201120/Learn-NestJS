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
