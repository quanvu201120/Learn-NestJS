/* eslint-disable @typescript-eslint/no-unused-vars */
import {
    BadRequestException,
    forwardRef,
    Inject,
    Injectable,
} from '@nestjs/common';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Message, MessageDocument } from './schemas/message.schema';
import { Connection, Model, Types } from 'mongoose';
import { toObjectId } from '@/utils/utils';
import { ConversationsService } from '../conversations/conversations.service';

@Injectable()
export class MessagesService {
    constructor(
        @InjectModel(Message.name)
        private readonly messageModel: Model<MessageDocument>,
        @Inject(forwardRef(() => ConversationsService))
        private readonly conversationService: ConversationsService,
        @InjectConnection()
        private readonly connection: Connection,
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

    async createMessage(
        senderId: string,
        conversationId: string,
        createMessageDto: CreateMessageDto,
    ) {
        const { conversation, objectConversationId } =
            await this.conversationService.getConversationOrThrow(
                conversationId,
            );
        const objectSenderId =
            this.conversationService.ensureMemberInConversation(
                conversation,
                senderId,
            );
        const { type, content, replyTo } = createMessageDto;
        let objectReplyTo: Types.ObjectId | undefined;
        if (replyTo) {
            const replyMessage = await this.checkMessageExistInConversation(
                replyTo,
                conversationId,
            );
            if (!replyMessage) {
                throw new BadRequestException('Reply message not found');
            }
            objectReplyTo = replyMessage._id;
        }
        const session = await this.connection.startSession();

        try {
            let newMessage: MessageDocument | null = null;
            await session.withTransaction(async () => {
                // bọc các lệnh ghi DB vào transaction thật
                const createdMessages = await this.messageModel.create(
                    [
                        {
                            conversationId: objectConversationId,
                            senderId: objectSenderId,
                            type,
                            content,
                            replyTo: objectReplyTo,
                        },
                    ],
                    { session }, // truyền session vào create để query này thuộc transaction
                );

                newMessage = createdMessages[0]; // create với session trả về mảng, lấy phần tử đầu

                await this.conversationService.updateLastMessageAndRestoreConversation(
                    conversationId,
                    newMessage._id.toString(),
                    senderId,
                    session, // truyền session xuống service conversation để update cùng transaction
                );
            });
            return newMessage;
        } finally {
            await session.endSession();
        }
    }
}
