import {
    BadRequestException,
    forwardRef,
    Inject,
    Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConversationsService } from '../conversations/conversations.service';
import { RelationshipsService } from '../relationships/relationships.service';
import { MESSAGE_MESSAGES } from './constants/message.constant';
import { MessageLookupService } from './message-lookup.service';
import { Message, MessageDocument } from './schemas/message.schema';
import { MessageReactionEnumType } from './types/message';
import { serializeMessage } from './utils/message.serializer';

@Injectable()
export class MessageReactionService {
    constructor(
        @InjectModel(Message.name)
        private readonly messageModel: Model<MessageDocument>,
        @Inject(forwardRef(() => ConversationsService))
        private readonly conversationService: ConversationsService,
        @Inject(forwardRef(() => RelationshipsService))
        private readonly relationshipsService: RelationshipsService,
        private readonly messageLookupService: MessageLookupService,
    ) {}

    async updateOrInsertReaction(
        userId: string,
        messageId: string,
        conversationId: string,
        type: MessageReactionEnumType,
    ) {
        const { conversation } =
            await this.conversationService.getConversationOrThrow(
                conversationId,
            );

        const objectUserId =
            this.conversationService.ensureMemberInConversation(
                conversation,
                userId,
            );

        const message =
            await this.messageLookupService.checkMessageExistInConversation(
                messageId,
                conversationId,
            );

        if (message.isDeleted) {
            throw new BadRequestException(MESSAGE_MESSAGES.ALREADY_DELETED);
        }
        if (message.callId) {
            throw new BadRequestException(
                MESSAGE_MESSAGES.CALL_MESSAGE_ACTION_NOT_ALLOWED,
            );
        }
        if (message.senderId.toString() !== userId) {
            const isBlocked = await this.relationshipsService.checkIsBlocked(
                userId,
                message.senderId.toString(),
            );
            if (isBlocked) {
                throw new BadRequestException(
                    MESSAGE_MESSAGES.CANNOT_REACT_BLOCKED_USER,
                );
            }
        }

        const hasReacted = message.reactions?.some((reaction) =>
            reaction.user.equals(objectUserId),
        );
        const updatedMessage = !hasReacted
            ? await this.messageModel
                  .findOneAndUpdate(
                      { _id: message._id },
                      {
                          $push: { reactions: { user: objectUserId, type } },
                      },
                      { returnDocument: 'after', runValidators: true },
                  )
                  .populate({
                      path: 'senderId',
                      select: '-password -email -phone -__v',
                      populate: { path: 'avatar', select: '-__v' },
                  })
                  .populate('replyTo', '-__v')
                  .populate('mediaId', '-__v')
                  .populate('callId', '-__v')
                  .lean()
            : await this.messageModel
                  .findOneAndUpdate(
                      { _id: message._id },
                      {
                          $set: { 'reactions.$[elem].type': type },
                      },
                      {
                          arrayFilters: [{ 'elem.user': objectUserId }],
                          returnDocument: 'after',
                          runValidators: true,
                      },
                  )
                  .populate({
                      path: 'senderId',
                      select: '-password -email -phone -__v',
                      populate: { path: 'avatar', select: '-__v' },
                  })
                  .populate('replyTo', '-__v')
                  .populate('mediaId', '-__v')
                  .populate('callId', '-__v')
                  .lean();
        if (!updatedMessage) {
            throw new BadRequestException(MESSAGE_MESSAGES.MESSAGE_NOT_UPDATED);
        }
        return serializeMessage(updatedMessage);
    }

    async removeReaction(
        userId: string,
        messageId: string,
        conversationId: string,
    ) {
        const { conversation } =
            await this.conversationService.getConversationOrThrow(
                conversationId,
            );

        const objectUserId =
            this.conversationService.ensureMemberInConversation(
                conversation,
                userId,
            );

        const message =
            await this.messageLookupService.checkMessageExistInConversation(
                messageId,
                conversationId,
            );

        if (message.isDeleted) {
            throw new BadRequestException(MESSAGE_MESSAGES.ALREADY_DELETED);
        }
        if (message.callId) {
            throw new BadRequestException(
                MESSAGE_MESSAGES.CALL_MESSAGE_ACTION_NOT_ALLOWED,
            );
        }

        const updatedMessage = await this.messageModel
            .findOneAndUpdate(
                { _id: message._id },
                {
                    $pull: { reactions: { user: objectUserId } },
                },
                { returnDocument: 'after', runValidators: true },
            )
            .populate({
                path: 'senderId',
                select: '-password -email -phone -__v',
                populate: { path: 'avatar', select: '-__v' },
            })
            .populate('replyTo', '-__v')
            .populate('mediaId', '-__v')
            .populate('callId', '-__v')
            .lean();

        if (!updatedMessage) {
            throw new BadRequestException(MESSAGE_MESSAGES.MESSAGE_NOT_UPDATED);
        }

        return serializeMessage(updatedMessage);
    }
}
