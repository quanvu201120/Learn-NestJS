/* eslint-disable @typescript-eslint/no-unused-vars */
import { MESSAGE_MESSAGES } from './constants/message.constant';
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
import {
    Message,
    MessageDocument,
    MessageEnumType,
} from './schemas/message.schema';
import { Connection, Model, Types, ClientSession } from 'mongoose';
import { parseDateOrThrow, toObjectId } from '@/utils/utils';
import { ConversationsService } from '../conversations/conversations.service';
import { GLOBAL_CONSTANTS } from '@/common/constants/global.constant';
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

    /**
     * Lấy chi tiết một tin nhắn theo ID, kèm theo thông tin người gửi và tin nhắn được reply.
     */
    async getMessageById(messageId: string) {
        const objectMessageId = toObjectId(messageId, 'message id');
        const message = await this.messageModel
            .findById(objectMessageId)
            .populate('senderId', '-password -__v')
            .populate('replyTo', '-__v')
            .lean();

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
        return await this.messageModel.findOne({
            _id: objectMessageId,
            conversationId: objectConversationId,
        });
    }

    /**
     * Gửi tin nhắn mới vào phòng chat.
     * Xử lý Transaction (ACID) để đảm bảo:
     * 1. Lưu tin nhắn vào collection Messages.
     * 2. Cập nhật `lastMessageId` cho Conversation tương ứng.
     */
    async createMessage(
        senderId: string,
        conversationId: string,
        type: MessageEnumType,
        content: string,
        replyTo?: string,
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
        let objectReplyTo: Types.ObjectId | undefined;
        if (replyTo) {
            const replyMessage = await this.checkMessageExistInConversation(
                replyTo,
                conversationId,
            );
            if (!replyMessage) {
                throw new BadRequestException(MESSAGE_MESSAGES.REPLY_NOT_FOUND);
            }
            if (replyMessage.isDeleted) {
                throw new BadRequestException(MESSAGE_MESSAGES.REPLY_DELETED);
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
                throw new InternalServerErrorException(
                    MESSAGE_MESSAGES.MESSAGE_NOT_CREATED,
                );
            }
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
            const { __v, ...result } = (
                newMessage as MessageDocument
            ).toObject();
            return { message: serializeMessage(result), conversation };
        } finally {
            await session.endSession();
        }
    }

    /**
     * Lấy tin nhắn mới nhất của một cuộc trò chuyện dựa trên lastMessageId.
     */
    async getLatestMessageOfConversation(conversationId: string) {
        const { conversation, objectConversationId } =
            await this.conversationService.getConversationOrThrow(
                conversationId,
            );

        if (!conversation.lastMessageId) {
            throw new BadRequestException(
                MESSAGE_MESSAGES.CONVERSATION_NO_MESSAGES,
            );
        }
        const lastMessage = await this.messageModel
            .findById(conversation.lastMessageId)
            .populate('senderId', '-password -__v')
            .populate('replyTo', '-__v')
            .lean();
        if (!lastMessage) {
            throw new BadRequestException(MESSAGE_MESSAGES.MESSAGE_NOT_FOUND);
        }
        return serializeMessage(lastMessage);
    }

    /**
     * Lấy danh sách tin nhắn của phòng chat (có phân trang bằng cursor).
     * Bỏ qua các tin nhắn cũ nếu người dùng đã từng Ẩn phòng chat (hiddenHistory).
     */
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
            .limit(GLOBAL_CONSTANTS.LIMIT_MESSAGES_DEFAULT)
            .lean();
        return result.map((message) => serializeMessage(message));
    }

    /**
     * Thu hồi (xóa mềm) tin nhắn của người gửi.
     */
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
                MESSAGE_MESSAGES.CANNOT_DELETE_USER_HIDDEN,
            );
        }
        const checkMessage = await this.checkMessageExistInConversation(
            messageId,
            conversationId,
        );
        if (!checkMessage) {
            throw new BadRequestException(
                MESSAGE_MESSAGES.NOT_BELONG_TO_CONVERSATION,
            );
        }
        if (checkMessage.senderId.toString() !== userId) {
            throw new BadRequestException(MESSAGE_MESSAGES.NOT_MESSAGE_OWNER);
        }
        if (checkMessage.isDeleted) {
            throw new BadRequestException(MESSAGE_MESSAGES.ALREADY_DELETED);
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
        return MESSAGE_MESSAGES.DELETE_SUCCESS;
    }

    /**
     * Xóa vĩnh viễn toàn bộ tin nhắn của một cuộc trò chuyện.
     * Được gọi khi giải tán nhóm.
     */
    async deleteMessagesByConversationId(
        conversationId: string,
        session?: ClientSession,
    ) {
        const objectConversationId = toObjectId(
            conversationId,
            'conversation id',
        );
        await this.messageModel.deleteMany(
            {
                conversationId: objectConversationId,
            },
            { session },
        );
    }
}
