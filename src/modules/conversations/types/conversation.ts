import { Types } from 'mongoose';
import { Conversation } from '../schemas/conversation.schema';
import { MessageResponse } from '@/modules/messages/types/message';
import { UserResponse } from '@/modules/users/types/user';

export type ConversationResponse = Omit<
    Conversation,
    'users' | 'lastMessageId'
> & {
    _id: Types.ObjectId | string;
    createdAt?: Date;
    updatedAt?: Date;
    users: UserResponse[] | Types.ObjectId[] | string[];
    lastMessage?: MessageResponse | Types.ObjectId | string;
};

export type UpdateNameConversationResponse = {
    updated: boolean;
};
export type UpdateAdminConversationResponse = {
    updated: boolean;
};
