import { MessageResponse } from '../types/message';

export const serializeReplyMessage = (replyTo: any) => {
    if (!replyTo || typeof replyTo !== 'object' || !('_id' in replyTo)) {
        return replyTo;
    }

    return serializeMessage(replyTo);
};

export const serializeMessage = (message: any): MessageResponse => {
    const { senderId, replyTo, ...rest } = message;

    return {
        ...rest,
        sender: senderId,
        replyTo: replyTo ? serializeReplyMessage(replyTo) : undefined,
    };
};
