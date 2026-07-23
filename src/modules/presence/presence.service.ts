import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RedisService } from '@/redis/redis.service';
import { toObjectId } from '@/utils/utils';
import {
    Conversation,
    ConversationDocument,
} from '../conversations/schemas/conversation.schema';

@Injectable()
export class PresenceService {
    constructor(
        private readonly redisService: RedisService,
        @InjectModel(Conversation.name)
        private readonly conversationModel: Model<ConversationDocument>,
    ) {}

    /**
     * Trả về danh sách user id đang online trong tập id được truyền vào,
     * chỉ giới hạn ở những user có chung ít nhất một conversation với người gọi.
     */
    async getUserOnline(listIds: string[], currentUserId: string) {
        const currentUserObjectId = toObjectId(currentUserId, 'userId');
        const listObjectIds = listIds.map((id) => toObjectId(id, 'userId'));

        //tìm tất cả conversation chứa user hiện tại và user cần check,và tra về unique của field "users", distinct chỉ lấy 1 field
        const sharedUsers = await this.conversationModel.distinct('users', {
            users: { $all: [currentUserObjectId], $in: listObjectIds },
        });
        const sharedUserIds = new Set(sharedUsers.map((id) => id.toString()));
        const allowedIds = listIds.filter((id) => sharedUserIds.has(id));

        return await this.redisService.getUserOnlineInListIds(allowedIds);
    }
}
