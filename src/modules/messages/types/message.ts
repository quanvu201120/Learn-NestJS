import { UserResponse } from '@/modules/users/types/user';
import { Types } from 'mongoose';
import { Message } from '../schemas/message.schema';
import { Media } from '@/modules/media/schemas/media.schema';
import { Call } from '@/modules/calls/schemas/call.schema';

export type MessageResponse = Omit<
    Message,
    'senderId' | 'replyTo' | 'mediaId' | 'callId'
> & {
    _id: Types.ObjectId | string;
    createdAt?: Date;
    updatedAt?: Date;
    sender: UserResponse | Types.ObjectId | string;
    media?: Media | Types.ObjectId | string;
    call?: Call | Types.ObjectId | string;
    replyTo?: MessageResponse | Types.ObjectId | string;
};

export type ListMessagesResponse = {
    nextCursor: string | null;
    messages: MessageResponse[];
};

export type MessageCreatedEvents = {
    restoredConversation?: {
        conversationId: string;
        members: string[];
    };
    unseenMessage?: {
        conversationId: string;
        userIds: string[];
    };
    createdMessage?: MessageResponse;
};

export enum MessageReactionEnumType {
    LIKE = 'like',
    LOVE = 'love',
    HAHA = 'haha',
    WOW = 'wow',
    SAD = 'sad',
    ANGRY = 'angry',
}

export enum MessageEnumType {
    TEXT = 'text',
    IMAGE = 'image',
    VIDEO = 'video',
    FILE = 'file',
    VOICE = 'voice',
    SYSTEM = 'system',
    CALL_AUDIO = 'callAudio',
    CALL_VIDEO = 'callVideo',
}
