import { Injectable } from '@nestjs/common';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Message, MessageDocument } from './schemas/message.schema';
import { Model } from 'mongoose';
import { toObjectId } from '@/utils/utils';

@Injectable()
export class MessagesService {
    constructor(
        @InjectModel(Message.name)
        private readonly messageModel: Model<MessageDocument>,
    ) {}

    async getMessageById(messageId: string) {
        const objectMessageId = toObjectId(messageId, 'message id');
        return await this.messageModel
            .findById(objectMessageId)
            .populate('senderId', '-password');
    }
    async checkMessageExistInConversation(
        messageId: string,
        conversationId: string,
    ) {
        const objectMessageId = toObjectId(messageId, 'message id');
        const objectConversationId = toObjectId(
            conversationId,
            'conversation id',
        );
        return await this.messageModel
            .findOne({
                _id: objectMessageId,
                conversationId: objectConversationId,
            })
            .populate('senderId', '-password');
    }
}
