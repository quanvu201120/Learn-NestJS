/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Types } from 'mongoose';
import { MessageResponse } from '../types/message';

export const serializeReplyMessage = (replyTo: any) => {
    if (
        typeof replyTo !== 'object' ||
        replyTo instanceof Types.ObjectId ||
        !Object.keys(replyTo).includes('_id')
    ) {
        return replyTo.toString();
    }

    return serializeMessage(replyTo);
};

export const serializeMessage = (message: any): MessageResponse => {
    const { senderId, replyTo, ...rest } = message;

    return {
        ...rest,
        _id: rest._id ? rest._id.toString() : undefined,
        conversationId: rest.conversationId
            ? rest.conversationId.toString()
            : undefined,
        sender:
            senderId &&
            typeof senderId === 'object' &&
            !(senderId instanceof Types.ObjectId) &&
            Object.keys(senderId).includes('_id')
                ? { ...senderId, _id: senderId._id.toString() }
                : senderId
                  ? senderId.toString()
                  : undefined,
        replyTo: replyTo ? serializeReplyMessage(replyTo) : undefined,
    };
};
