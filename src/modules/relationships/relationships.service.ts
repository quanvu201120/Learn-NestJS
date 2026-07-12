import {
    BadRequestException,
    Injectable,
    Inject,
    forwardRef,
} from '@nestjs/common';
import { CreateRelationshipDto } from './dto/create-relationship.dto';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
    Relationship,
    RelationshipDocument,
} from './schemas/relationship.schema';
import { UsersService } from '../users/users.service';
import { Subject } from 'rxjs';
import { RelationshipStatusEnum } from './types/relationship';
import { formatDateTime, toObjectId } from '@/utils/utils';
import { serializeRelationship } from './utils/relationship.serializer';
import { RELATIONSHIP_MESSAGES } from './constants/relationship.constant';
import { ConversationsService } from '../conversations/conversations.service';
import { MessagesService } from '../messages/messages.service';
import { MessageEnumType } from '../messages/types/message';
import { AUTH_MESSAGES } from '@/auth/constants/auth.constant';

@Injectable()
export class RelationshipsService {
    public readonly relationshipCreated$ = new Subject<{
        recipientId: string;
    }>();

    public readonly relationshipAccepted$ = new Subject<{
        userIds: string[];
    }>();

    public readonly relationshipDeleted$ = new Subject<{
        targetUserId: string;
    }>();

    public readonly relationshipBlocked$ = new Subject<{
        targetUserId: string;
    }>();

    public readonly relationshipUnblocked$ = new Subject<{
        targetUserId: string;
    }>();

    constructor(
        @InjectModel(Relationship.name)
        private relationshipModel: Model<RelationshipDocument>,
        @Inject(forwardRef(() => UsersService))
        private readonly usersService: UsersService,
        @Inject(forwardRef(() => ConversationsService))
        private readonly conversationsService: ConversationsService,
        @Inject(forwardRef(() => MessagesService))
        private readonly messagesService: MessagesService,
    ) {}

    /**
     * Lấy danh sách relationship của user (Bao gồm tất cả các trạng thái của user, để FE tự filter)
     */
    async getRelationshipByUser(userId: string) {
        await this.usersService.checkUser(userId, false, false, false);
        const result = await this.relationshipModel
            .find({
                $or: [
                    {
                        requester: toObjectId(userId, 'userId'),
                    },
                    {
                        recipient: toObjectId(userId, 'userId'),
                    },
                ],
            })
            .populate([
                {
                    path: 'requester',
                    populate: {
                        path: 'avatar',
                        select: '-__v -password -phone -email',
                    },
                },
                {
                    path: 'recipient',
                    populate: {
                        path: 'avatar',
                        select: '-__v -password -phone -email',
                    },
                },
            ])
            .select('-__v')
            .lean();

        return result.map((relationship) =>
            serializeRelationship(relationship),
        );
    }

    /**
     * Chấp nhận lời mời kết bạn.
     */
    async accept(relationshipId: string, userId: string, targetUserId: string) {
        const { recipient: currentUser } =
            await this.checkActiveRequesterAndRecipient(targetUserId, userId);
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
                    new: true,
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
            } catch (err) {
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

        this.relationshipAccepted$.next({
            userIds: [
                relationship.requester.toString(),
                relationship.recipient.toString(),
            ],
        });

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
            await this.checkActiveRequesterAndRecipient(
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
        if (status === RelationshipStatusEnum.PENDING) {
            this.relationshipCreated$.next({
                recipientId: recipient._id.toString(),
            });
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
        await this.checkActiveRequesterAndRecipient(
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
        this.relationshipDeleted$.next({ targetUserId });

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
        await this.checkActiveRequesterAndRecipient(
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

        this.relationshipDeleted$.next({ targetUserId });
        return true;
    }

    /**
     * Chặn một user cụ thể, cho phép chặn người lạ, tránh spam quấy rối
     */
    async blockUser(userId: string, blockId: string, session?: ClientSession) {
        await this.checkActiveRequesterAndRecipient(userId, blockId, false);
        const relationship = await this.relationshipModel
            .findOne({
                $or: [
                    {
                        requester: toObjectId(userId, 'userId'),
                        recipient: toObjectId(blockId, 'blockId'),
                    },
                    {
                        requester: toObjectId(blockId, 'blockId'),
                        recipient: toObjectId(userId, 'userId'),
                    },
                ],
            })
            .select('-__v')
            .session(session || null)
            .lean();
        if (!relationship) {
            const created = await this.create(
                {
                    recipient: blockId,
                },
                userId,
                RelationshipStatusEnum.BLOCKED,
            );
            this.relationshipBlocked$.next({ targetUserId: blockId });
            return created;
        }
        if (relationship.status === RelationshipStatusEnum.BLOCKED) {
            if (relationship.blockedBy?.toString() === userId) {
                throw new BadRequestException(
                    RELATIONSHIP_MESSAGES.ALREADY_BLOCKED,
                );
            } else {
                throw new BadRequestException(
                    RELATIONSHIP_MESSAGES.CANNOT_BLOCK,
                );
            }
        }

        const updated = await this.relationshipModel
            .findByIdAndUpdate(
                relationship._id,
                {
                    status: RelationshipStatusEnum.BLOCKED,
                    blockedBy: toObjectId(userId, 'userId'),
                },
                { new: true },
            )
            .select('-__v')
            .session(session || null)
            .lean();
        if (!updated) {
            throw new BadRequestException(RELATIONSHIP_MESSAGES.BLOCK_FAILED);
        }

        this.relationshipBlocked$.next({ targetUserId: blockId });

        return updated;
    }

    /**
     * Bỏ chặn một user cụ thể
     */
    async unblockUser(userId: string, blockId: string) {
        const objectUserId = toObjectId(userId, 'userId');
        const objectBlockId = toObjectId(blockId, 'blockId');
        await this.checkActiveRequesterAndRecipient(userId, blockId, false);
        const deleted = await this.relationshipModel.findOneAndDelete({
            $or: [
                {
                    requester: objectUserId,
                    recipient: objectBlockId,
                },
                {
                    requester: objectBlockId,
                    recipient: objectUserId,
                },
            ],
            status: RelationshipStatusEnum.BLOCKED,
            blockedBy: objectUserId,
        });
        if (!deleted) {
            throw new BadRequestException(RELATIONSHIP_MESSAGES.UNBLOCK_FAILED);
        }

        this.relationshipUnblocked$.next({ targetUserId: blockId });

        return true;
    }

    /**
     * Kiểm tra xem 2 user có ai đang block ai không.
     */
    async checkIsBlocked(userId1: string, userId2: string) {
        const relationship = await this.relationshipModel
            .findOne({
                $or: [
                    {
                        requester: toObjectId(userId1, 'userId1'),
                        recipient: toObjectId(userId2, 'userId2'),
                    },
                    {
                        requester: toObjectId(userId2, 'userId2'),
                        recipient: toObjectId(userId1, 'userId1'),
                    },
                ],
                status: RelationshipStatusEnum.BLOCKED,
            })
            .lean();

        return relationship;
    }

    /**
     * Kiểm tra xem 2 user có đang là bạn bè không.
     */
    async checkIsFriend(userId1: string, userId2: string): Promise<boolean> {
        const relationship = await this.relationshipModel
            .findOne({
                $or: [
                    {
                        requester: toObjectId(userId1, 'userId1'),
                        recipient: toObjectId(userId2, 'userId2'),
                    },
                    {
                        requester: toObjectId(userId2, 'userId2'),
                        recipient: toObjectId(userId1, 'userId1'),
                    },
                ],
                status: RelationshipStatusEnum.ACCEPTED,
            })
            .lean();

        return !!relationship;
    }

    /**
     * Lấy danh sách ID bạn bè (ACCEPTED) từ một mảng targetUserIds đầu vào.
     * Dùng để tối ưu hóa truy vấn thay vì gọi checkIsFriend nhiều lần trong vòng lặp.
     */
    async getFriendIdsAmongUsers(
        userId: string,
        targetUserIds: string[],
    ): Promise<string[]> {
        if (!targetUserIds || targetUserIds.length === 0) return [];

        const objectUserId = toObjectId(userId, 'userId');
        const objectTargetUserIds = targetUserIds.map((id) =>
            toObjectId(id, 'targetUserId'),
        );

        const relationships = await this.relationshipModel
            .find({
                status: RelationshipStatusEnum.ACCEPTED,
                $or: [
                    {
                        requester: objectUserId,
                        recipient: { $in: objectTargetUserIds },
                    },
                    {
                        recipient: objectUserId,
                        requester: { $in: objectTargetUserIds },
                    },
                ],
            })
            .lean();

        return relationships.map((rel) => {
            if (rel.requester.equals(objectUserId)) {
                return rel.recipient.toString();
            }
            return rel.requester.toString();
        });
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

    /**
     * Kiểm tra 2 user có tồn tại và hoạt động bình thường hay không.
     * Nếu requireTargetActive = false, chỉ kiểm tra người thao tác (requesterId),
     * còn target (recipientId) dù bị vô hiệu hóa vẫn cho phép thao tác.
     */
    private async checkActiveRequesterAndRecipient(
        requesterId: string,
        recipientId: string,
        requireTargetActive: boolean = true,
    ) {
        if (requesterId === recipientId) {
            throw new BadRequestException(
                RELATIONSHIP_MESSAGES.CANNOT_BE_SAME_USER,
            );
        }
        const [requester, recipient] = await Promise.all([
            this.usersService.findOne(requesterId),
            this.usersService.findOne(recipientId),
        ]);
        if (!requester || !recipient) {
            throw new BadRequestException(RELATIONSHIP_MESSAGES.USER_NOT_FOUND);
        }

        if (!requester.isActive) {
            throw new BadRequestException(
                RELATIONSHIP_MESSAGES.REQUESTER_NOT_ACTIVE,
            );
        }

        if (requester.isDisabled) {
            throw new BadRequestException(
                RELATIONSHIP_MESSAGES.REQUESTER_DISABLED,
            );
        }

        if (requireTargetActive) {
            if (!recipient.isActive) {
                throw new BadRequestException(
                    RELATIONSHIP_MESSAGES.RECIPIENT_NOT_ACTIVE,
                );
            }
            if (recipient.isDisabled) {
                throw new BadRequestException(
                    RELATIONSHIP_MESSAGES.RECIPIENT_DISABLED,
                );
            }
            if (recipient.banUntil && recipient.banUntil > new Date()) {
                const time = formatDateTime(recipient.banUntil);
                throw new BadRequestException(
                    AUTH_MESSAGES.ACCOUNT_BANNED_UNTIL(time),
                );
            }
        }
        return { requester, recipient };
    }
}
