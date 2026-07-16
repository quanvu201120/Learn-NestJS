import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { toObjectId } from '@/utils/utils';
import { MESSAGE_MESSAGES } from './constants/message.constant';
import { Message, MessageDocument } from './schemas/message.schema';
import { serializeMessage } from './utils/message.serializer';

@Injectable()
export class MessageLookupService {
    constructor(
        @InjectModel(Message.name)
        private readonly messageModel: Model<MessageDocument>,
    ) {}

    /**
     * Lấy chi tiết một tin nhắn theo ID, kèm theo thông tin người gửi và tin nhắn được reply.
     */
    async getMessageById(messageId: string, session?: ClientSession) {
        const objectMessageId = toObjectId(messageId, 'message id');
        let query = this.messageModel
            .findById(objectMessageId)
            .populate({
                path: 'senderId',
                select: '-password -email -phone -__v',
                populate: { path: 'avatar', select: '-__v' },
            })
            .populate('replyTo', '-__v')
            .populate('mediaId', '-__v');

        if (session) {
            query = query.session(session);
        }

        const message = await query.lean();

        if (!message) {
            throw new BadRequestException(MESSAGE_MESSAGES.MESSAGE_NOT_FOUND);
        }

        return serializeMessage(message);
    }

    /**
     * Kiểm tra xem một tin nhắn có tồn tại và thuộc về một cuộc trò chuyện cụ thể hay không.
     */
    async checkMessageExistInConversation(
        messageId: string,
        conversationId: string,
    ) {
        const objectMessageId = toObjectId(messageId, 'message id');
        const objectConversationId = toObjectId(
            conversationId,
            'conversation id',
        );
        const result = await this.messageModel.findOne({
            _id: objectMessageId,
            conversationId: objectConversationId,
        });
        if (!result) {
            throw new BadRequestException(MESSAGE_MESSAGES.MESSAGE_NOT_FOUND);
        }
        return result;
    }
}
