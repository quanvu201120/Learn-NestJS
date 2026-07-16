import { toObjectId } from '@/utils/utils';
import {
    BadRequestException,
    Inject,
    Injectable,
    forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConversationsService } from '../conversations/conversations.service';
import { MessagesService } from '../messages/messages.service';
import { MessageEnumType } from '../messages/types/message';
import { CreateRelationshipDto } from './dto/create-relationship.dto';
import { RELATIONSHIP_MESSAGES } from './constants/relationship.constant';
import { RelationshipAccessService } from './relationship-access.service';
import {
    Relationship,
    RelationshipDocument,
} from './schemas/relationship.schema';
import { RelationshipStatusEnum } from './types/relationship';

@Injectable()
export class RelationshipRequestService {
    constructor(
        @InjectModel(Relationship.name)
        private relationshipModel: Model<RelationshipDocument>,
        private readonly relationshipAccessService: RelationshipAccessService,
        @Inject(forwardRef(() => ConversationsService))
        private readonly conversationsService: ConversationsService,
        @Inject(forwardRef(() => MessagesService))
        private readonly messagesService: MessagesService,
    ) {}

    /**
     * Chấp nhận lời mời kết bạn.
     */
    async accept(relationshipId: string, userId: string, targetUserId: string) {
        const { recipient: currentUser } =
            await this.relationshipAccessService.checkActiveRequesterAndRecipient(
                targetUserId,
                userId,
            );
        const relationship = await this.relationshipModel
            .findOne({
                _id: toObjectId(relationshipId, 'relationshipId'),
                status: RelationshipStatusEnum.PENDING,
                recipient: toObjectId(userId, 'userId'),
                requester: toObjectId(targetUserId, 'targetUserId'),
            })
            .select('-__v')
            .lean();
        if (!relationship) {
            throw new BadRequestException(
                RELATIONSHIP_MESSAGES.RELATIONSHIP_NOT_FOUND,
            );
        }
        const accepted = await this.relationshipModel
            .findOneAndUpdate(
                {
                    _id: relationship._id,
                    recipient: toObjectId(userId, 'userId'),
                    status: RelationshipStatusEnum.PENDING,
                },
                {
                    status: RelationshipStatusEnum.ACCEPTED,
                },
                {
                    returnDocument: 'after',
                },
            )
            .select('-__v')
            .lean();
        if (!accepted) {
            throw new BadRequestException(RELATIONSHIP_MESSAGES.UPDATE_FAILED);
        }

        try {
            const conversation =
                await this.conversationsService.createConversation(
                    {
                        users: [targetUserId],
                        isGroup: false,
                    },
                    userId,
                );

            // Tự động chấp nhận tin nhắn chờ nếu có
            try {
                await this.conversationsService.acceptConversation(
                    conversation._id.toString(),
                    userId,
                );
            } catch {
                // Bỏ qua lỗi nếu đã accept rồi
            }

            await this.messagesService.createMessage(
                userId,
                conversation._id.toString(),
                MessageEnumType.SYSTEM,
                `${currentUser.name} đã chấp nhận lời mời kết bạn`,
            );
        } catch (error) {
            console.error(
                'Error creating system message on friend accept:',
                error,
            );
        }

        return accepted;
    }

    /**
     * Tạo relationship
     */
    async create(
        createRelationshipDto: CreateRelationshipDto,
        userId: string,
        status: RelationshipStatusEnum = RelationshipStatusEnum.PENDING,
    ) {
        const { requester, recipient } =
            await this.relationshipAccessService.checkActiveRequesterAndRecipient(
                userId,
                createRelationshipDto.recipient,
            );
        const relationship = await this.getPendingRelationshipOrNull(
            requester._id,
            recipient._id,
        );
        if (
            relationship &&
            relationship.status === RelationshipStatusEnum.PENDING
        ) {
            if (
                relationship.requester.toString() === requester._id.toString()
            ) {
                throw new BadRequestException(
                    RELATIONSHIP_MESSAGES.FRIEND_REQUEST_ALREADY_SENT,
                );
            }

            return await this.accept(
                relationship._id.toString(),
                userId,
                createRelationshipDto.recipient,
            );
        }

        const created = await this.relationshipModel.create({
            requester: requester._id,
            recipient: recipient._id,
            status,
            blockedBy:
                status === RelationshipStatusEnum.BLOCKED
                    ? requester._id
                    : undefined,
        });
        if (!created) {
            throw new BadRequestException(RELATIONSHIP_MESSAGES.CREATE_FAILED);
        }

        return created;
    }

    /**
     * Từ chối lời mời kết bạn hoặc xóa lời mời kết bạn đã gửi.
     */
    async rejectOrRemove(
        relationshipId: string,
        userId: string,
        targetUserId: string,
    ) {
        await this.relationshipAccessService.checkActiveRequesterAndRecipient(
            userId,
            targetUserId,
            false,
        );
        await this.deleteOne(
            toObjectId(relationshipId, 'relationshipId'),
            toObjectId(userId, 'userId'),
            toObjectId(targetUserId, 'targetUserId'),
            RelationshipStatusEnum.PENDING,
        );

        return true;
    }

    /**
     * Hủy kết bạn.
     */
    async unfriend(
        relationshipId: string,
        userId: string,
        targetUserId: string,
    ) {
        await this.relationshipAccessService.checkActiveRequesterAndRecipient(
            userId,
            targetUserId,
            false,
        );
        await this.deleteOne(
            toObjectId(relationshipId, 'relationshipId'),
            toObjectId(userId, 'userId'),
            toObjectId(targetUserId, 'targetUserId'),
            RelationshipStatusEnum.ACCEPTED,
        );

        return true;
    }

    /**
     * Xóa một relationship bất kỳ
     */
    private async deleteOne(
        relationshipId: Types.ObjectId,
        userId: Types.ObjectId,
        targetUserId: Types.ObjectId,
        status: RelationshipStatusEnum,
    ) {
        const relationship = await this.relationshipModel
            .findOneAndDelete({
                _id: relationshipId,
                status: status,
                $or: [
                    { requester: userId, recipient: targetUserId },
                    { requester: targetUserId, recipient: userId },
                ],
            })
            .lean();
        if (!relationship) {
            throw new BadRequestException(
                RELATIONSHIP_MESSAGES.RELATIONSHIP_NOT_FOUND,
            );
        }
        return relationship;
    }

    /**
     * Kiểm tra mối quan hệ đã tồn tại hay chưa
     * Nếu tồn tại với 2 trạng thái ACCEPTED hoặc BLOCKED thì throw exception
     * Trả về null hoặc relationship với status PENDING
     */
    private async getPendingRelationshipOrNull(
        requesterId: Types.ObjectId,
        recipientId: Types.ObjectId,
    ) {
        const relationship = await this.relationshipModel
            .findOne({
                $or: [
                    {
                        requester: requesterId,
                        recipient: recipientId,
                    },
                    {
                        requester: recipientId,
                        recipient: requesterId,
                    },
                ],
            })
            .lean();

        if (!relationship) {
            return null;
        }

        if (relationship.status === RelationshipStatusEnum.ACCEPTED) {
            throw new BadRequestException(
                RELATIONSHIP_MESSAGES.ALREADY_ACCEPTED,
            );
        }

        if (relationship.status === RelationshipStatusEnum.BLOCKED) {
            throw new BadRequestException(
                RELATIONSHIP_MESSAGES.RELATIONSHIP_ALREADY_BLOCKED,
            );
        }

        //pending
        return relationship;
    }
}
