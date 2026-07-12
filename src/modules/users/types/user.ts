import { Types } from 'mongoose';
import { User } from '../schemas/user.schema';
import { Media } from '@/modules/media/schemas/media.schema';

export enum UserRole {
    USER = 'USER',
    ADMIN = 'ADMIN',
    SUPER_ADMIN = 'SUPER_ADMIN',
}

export enum UserGenderEnum {
    MALE = 'MALE',
    FEMALE = 'FEMALE',
    OTHER = 'OTHER',
}

export enum UserAccountType {
    LOCAL = 'LOCAL',
    GOOGLE = 'GOOGLE',
}

export type UserResponse = Omit<User, 'password' | 'avatar'> & {
    _id: Types.ObjectId | string;
    createdAt?: Date;
    updatedAt?: Date;
    avatar?: Media | Types.ObjectId | string;
};

export type UserResponseWithPagination = {
    totalPages: number;
    totalItems: number;
    users: UserResponse[];
};

export type UserDisableStateResponse = {
    message: string;
    isDisabled: boolean;
};
