/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Types } from 'mongoose';
import { MessageResponse } from '../types/message';
import { serializeMedia } from '@/modules/media/utils/media.serializer';
import { serializeUser } from '@/modules/users/utils/user.serializer';

/**
 * Chuẩn hóa message được reply tới.
 * Nếu relation chưa populate thì giữ lại dưới dạng string id.
 */
export const serializeReplyMessage = (
    replyTo: any,
    hiddenUserIds: string[] = [],
) => {
    if (
        typeof replyTo !== 'object' ||
        replyTo instanceof Types.ObjectId ||
        !Object.keys(replyTo).includes('_id')
    ) {
        return replyTo.toString();
    }

    return serializeMessage(replyTo, hiddenUserIds);
};

/**
 * Chuyển document message thô thành response shape mà client sử dụng.
 */
export const serializeMessage = (
    message: any,
    hiddenUserIds: string[] = [],
): MessageResponse => {
    const { senderId, replyTo, mediaId, callId, ...rest } = message;
    const hiddenSet = new Set(hiddenUserIds);
    const senderIdString =
        senderId && typeof senderId === 'object' && '_id' in senderId
            ? senderId._id.toString()
            : senderId?.toString?.();
    const isSenderDisabled =
        senderId && typeof senderId === 'object' && senderId.isDisabled;
    const isSenderHidden = !!senderIdString && hiddenSet.has(senderIdString);
    const shouldHideSender = isSenderDisabled || isSenderHidden;

    return {
        ...rest,
        content: isSenderHidden
              ? 'Tin nhắn bị ẩn'
              : message.isDeleted
                ? ''
                : rest.content,
        _id: rest._id ? rest._id.toString() : undefined,
        conversationId: rest.conversationId
            ? rest.conversationId.toString()
            : undefined,
        sender: serializeUser(senderId, true, isSenderHidden),
        media:
            message.isDeleted || shouldHideSender
                ? undefined
                : mediaId &&
                    typeof mediaId === 'object' &&
                    !(mediaId instanceof Types.ObjectId) &&
                    Object.keys(mediaId).includes('_id')
                  ? serializeMedia(mediaId)
                  : mediaId
                    ? mediaId.toString()
                    : undefined,
        call:
            message.isDeleted || shouldHideSender
                ? undefined
                : callId &&
                    typeof callId === 'object' &&
                    !(callId instanceof Types.ObjectId) &&
                    Object.keys(callId).includes('_id')
                  ? {
                        ...callId,
                        _id: callId._id.toString(),
                        callerId: callId.callerId?.toString(),
                        calleeId: callId.calleeId?.toString(),
                        conversationId: callId.conversationId?.toString(),
                    }
                  : callId
                    ? callId.toString()
                    : undefined,
        replyTo: replyTo
            ? serializeReplyMessage(replyTo, hiddenUserIds)
            : undefined,
    };
};
