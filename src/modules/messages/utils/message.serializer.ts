/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Types } from 'mongoose';
import { MessageResponse } from '../types/message';
import { serializeMedia } from '@/modules/media/utils/media.serializer';

/**
 * Chuẩn hóa thông tin người gửi trong payload message.
 */
const serializeSender = (senderId: any) => {
    if (
        !senderId ||
        typeof senderId !== 'object' ||
        senderId instanceof Types.ObjectId ||
        !Object.keys(senderId).includes('_id')
    ) {
        return senderId ? senderId.toString() : undefined;
    }

    return {
        ...senderId,
        _id: senderId._id.toString(),
        avatar: senderId.avatar
            ? serializeMedia(senderId.avatar)
            : senderId.avatar,
    };
};

/**
 * Chuẩn hóa message được reply tới.
 * Nếu relation chưa populate thì giữ lại dưới dạng string id.
 */
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

/**
 * Chuyển document message thô thành response shape mà client sử dụng.
 */
export const serializeMessage = (message: any): MessageResponse => {
    const { senderId, replyTo, mediaId, ...rest } = message;

    return {
        ...rest,
        _id: rest._id ? rest._id.toString() : undefined,
        conversationId: rest.conversationId
            ? rest.conversationId.toString()
            : undefined,
        sender:
            serializeSender(senderId),
        media:
            mediaId &&
            typeof mediaId === 'object' &&
            !(mediaId instanceof Types.ObjectId) &&
            Object.keys(mediaId).includes('_id')
                ? serializeMedia(mediaId)
                : mediaId
                  ? mediaId.toString()
                  : undefined,
        replyTo: replyTo ? serializeReplyMessage(replyTo) : undefined,
    };
};
