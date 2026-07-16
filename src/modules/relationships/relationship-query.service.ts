import { toObjectId } from '@/utils/utils';
import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
    Relationship,
    RelationshipDocument,
} from './schemas/relationship.schema';
import { RelationshipStatusEnum } from './types/relationship';
import { serializeRelationship } from './utils/relationship.serializer';
import { UsersService } from '../users/users.service';

@Injectable()
export class RelationshipQueryService {
    constructor(
        @InjectModel(Relationship.name)
        private relationshipModel: Model<RelationshipDocument>,
        @Inject(forwardRef(() => UsersService))
        private readonly usersService: UsersService,
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
     * Lấy những user trong danh sách có relationship status BLOCK với user hiện tại.
     */
    async getBlockedUserIdsAmongUsers(
        userId: string,
        targetUserIds: string[],
    ): Promise<string[]> {
        if (!targetUserIds || targetUserIds.length === 0) {
            return [];
        }

        const objectUserId = toObjectId(userId, 'userId');
        const objectTargetUserIds = targetUserIds
            .filter((targetUserId) => targetUserId !== userId)
            .map((targetUserId) => toObjectId(targetUserId, 'targetUserId'));

        if (objectTargetUserIds.length === 0) {
            return [];
        }

        const relationships = await this.relationshipModel
            .find({
                status: RelationshipStatusEnum.BLOCKED,
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

        return relationships.map((relationship) => {
            if (relationship.requester.equals(objectUserId)) {
                return relationship.recipient.toString();
            }
            return relationship.requester.toString();
        });
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
}
