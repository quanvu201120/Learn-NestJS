import { toObjectId } from '@/utils/utils';
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { RELATIONSHIP_MESSAGES } from './constants/relationship.constant';
import { RelationshipAccessService } from './relationship-access.service';
import {
    Relationship,
    RelationshipDocument,
} from './schemas/relationship.schema';
import { RelationshipRequestService } from './relationship-request.service';
import { RelationshipStatusEnum } from './types/relationship';

@Injectable()
export class RelationshipBlockService {
    constructor(
        @InjectModel(Relationship.name)
        private relationshipModel: Model<RelationshipDocument>,
        private readonly relationshipAccessService: RelationshipAccessService,
        private readonly relationshipRequestService: RelationshipRequestService,
    ) {}

    /**
     * Chặn một user cụ thể, cho phép chặn người lạ, tránh spam quấy rối
     */
    async blockUser(userId: string, blockId: string, session?: ClientSession) {
        await this.relationshipAccessService.checkActiveRequesterAndRecipient(
            userId,
            blockId,
            false,
        );
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
            return this.relationshipRequestService.create(
                {
                    recipient: blockId,
                },
                userId,
                RelationshipStatusEnum.BLOCKED,
            );
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
                { returnDocument: 'after' },
            )
            .select('-__v')
            .session(session || null)
            .lean();
        if (!updated) {
            throw new BadRequestException(RELATIONSHIP_MESSAGES.BLOCK_FAILED);
        }

        return updated;
    }

    /**
     * Bỏ chặn một user cụ thể
     */
    async unblockUser(userId: string, blockId: string) {
        const objectUserId = toObjectId(userId, 'userId');
        const objectBlockId = toObjectId(blockId, 'blockId');
        await this.relationshipAccessService.checkActiveRequesterAndRecipient(
            userId,
            blockId,
            false,
        );
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

        return true;
    }
}
