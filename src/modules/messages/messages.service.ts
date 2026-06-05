/* eslint-disable @typescript-eslint/no-unused-vars */
import {
    BadRequestException,
    forwardRef,
    Inject,
    Injectable,
    InternalServerErrorException,
} from '@nestjs/common';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Message, MessageDocument } from './schemas/message.schema';
import { Connection, Model, Types } from 'mongoose';
import { parseDateOrThrow, toObjectId } from '@/utils/utils';
import { ConversationsService } from '../conversations/conversations.service';
import { LIMIT_MESSAGES_DEFAULT } from '@/utils/contans';
import { serializeMessage } from './utils/message.serializer';

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
        const message = await this.messageModel
            .findById(objectMessageId)
            .populate('senderId', '-password -__v')
            .populate('replyTo', '-__v')
            .lean();

        if (!message) {
            throw new BadRequestException('Message not found');
        }

        return serializeMessage(message);
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
        return await this.messageModel.findOne({
            _id: objectMessageId,
            conversationId: objectConversationId,
        });
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
            if (replyMessage.isDeleted) {
                throw new BadRequestException('Reply message is deleted');
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
            if (!newMessage) {
                throw new InternalServerErrorException('Message not created');
            }
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
            const { __v, ...result } = (
                newMessage as MessageDocument
            ).toObject();
            return serializeMessage(result);
        } finally {
            await session.endSession();
        }
    }

    async getLatestMessageOfConversation(conversationId: string) {
        const { conversation, objectConversationId } =
            await this.conversationService.getConversationOrThrow(
                conversationId,
            );

        if (!conversation.lastMessageId) {
            throw new BadRequestException('Conversation has no messages');
        }
        const lastMessage = await this.messageModel
            .findById(conversation.lastMessageId)
            .populate('senderId', '-password -__v')
            .populate('replyTo', '-__v')
            .lean();
        if (!lastMessage) {
            throw new BadRequestException('Message not found');
        }
        return serializeMessage(lastMessage);
    }

    async getMessagesByConversation(
        conversationId: string,
        userId: string,
        cursor?: string,
    ) {
        const { conversation, objectConversationId } =
            await this.conversationService.getConversationOrThrow(
                conversationId,
            );
        this.conversationService.ensureMemberInConversation(
            conversation,
            userId,
        );
        const userHidden = conversation.hiddenHistory.find(
            (item) => item.userId.toString() === userId,
        );

        const createdAtFilter: Record<string, Date> = {};
        if (cursor) {
            createdAtFilter.$lt = parseDateOrThrow(cursor, 'cursor');
        }
        if (userHidden?.hiddenAt) {
            createdAtFilter.$gte = userHidden.hiddenAt;
        }

        const result = await this.messageModel
            .find({
                conversationId: objectConversationId,
                ...(Object.keys(createdAtFilter).length > 0
                    ? { createdAt: createdAtFilter }
                    : {}),
            })
            .select('-__v')
            .populate('senderId', '-password -__v')
            .populate('replyTo', '-__v')
            .sort({ createdAt: -1 })
            .limit(LIMIT_MESSAGES_DEFAULT)
            .lean();
        return result.map((message) => serializeMessage(message));
    }

    async softDeleteMessage(
        messageId: string,
        conversationId: string,
        userId: string,
    ) {
        const { conversation, objectConversationId } =
            await this.conversationService.getConversationOrThrow(
                conversationId,
            );
        this.conversationService.ensureMemberInConversation(
            conversation,
            userId,
        );
        const userHidden = conversation.hiddenHistory.find(
            (item) => item.userId.toString() === userId && item.isHidden,
        );
        if (userHidden) {
            throw new BadRequestException(
                'User has deleted conversation, can not delete message',
            );
        }
        const checkMessage = await this.checkMessageExistInConversation(
            messageId,
            conversationId,
        );
        if (!checkMessage) {
            throw new BadRequestException(
                'Message not found or message not belong to this conversation',
            );
        }
        if (checkMessage.senderId.toString() !== userId) {
            throw new BadRequestException('User is not owner of this message');
        }
        if (checkMessage.isDeleted) {
            throw new BadRequestException('Message is already deleted');
        }
        const objectMessageId = toObjectId(messageId, 'message id');
        await this.messageModel
            .findOneAndUpdate(
                {
                    _id: objectMessageId,
                    conversationId: objectConversationId,
                },
                {
                    isDeleted: true,
                    deletedAt: new Date(),
                },
                { new: true },
            )
            .lean();
        return 'Deleted message successfully';
    }
}
