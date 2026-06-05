import { Types } from 'mongoose';
import { User } from '../schemas/user.schema';
export type UserResponse = Omit<User, 'password'> & {
    _id: Types.ObjectId | string;
    createdAt?: Date;
    updatedAt?: Date;
};
