import { UserResponse } from '@/modules/users/types/user';
import { Types } from 'mongoose';
import { Message } from '../schemas/message.schema';

export type MessageResponse = Omit<Message, 'senderId' | 'replyTo'> & {
    _id: Types.ObjectId | string;
    createdAt?: Date;
    updatedAt?: Date;
    sender: UserResponse | Types.ObjectId | string;
    replyTo?: MessageResponse | Types.ObjectId | string;
};

export enum MessageReactionEnumType {
    LIKE = 'like',
    LOVE = 'love',
    HAHA = 'haha',
    WOW = 'wow',
    SAD = 'sad',
    ANGRY = 'angry',
}
