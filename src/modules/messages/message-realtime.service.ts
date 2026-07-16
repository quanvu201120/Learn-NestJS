import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { RedisService } from '@/redis/redis.service';
import { RelationshipsService } from '../relationships/relationships.service';

@Injectable()
export class MessageRealtimeService {
    constructor(
        @Inject(forwardRef(() => RedisService))
        private readonly redisService: RedisService,
        @Inject(forwardRef(() => RelationshipsService))
        private readonly relationshipsService: RelationshipsService,
    ) {}

    /**
     * Đánh dấu conversation là chưa đọc cho các thành viên đang online
     * và trả về danh sách user cần phát sự kiện realtime.
     */
    async getUnseenMessageUserIds(
        members: Types.ObjectId[],
        senderId: string,
        conversationId: string,
    ) {
        const membersOnline = (
            await this.redisService.getUserOnlineInListIds(members)
        ).filter((item) => item.toString() !== senderId);

        const hiddenUserIds =
            membersOnline.length > 0
                ? await this.relationshipsService.getBlockedUserIdsAmongUsers(
                      senderId,
                      membersOnline.map((item) => item.toString()),
                  )
                : [];
        const hiddenUserIdSet = new Set(hiddenUserIds);
        const visibleMembersOnline = membersOnline.filter(
            (item) => !hiddenUserIdSet.has(item.toString()),
        );

        if (visibleMembersOnline.length === 0) {
            return [];
        }

        const resultUnseen = await this.redisService.setUnseenMessage(
            visibleMembersOnline,
            conversationId,
        );

        return (
            resultUnseen
                ?.map(([pipelineError, result], index) =>
                    !pipelineError && Number(result) > 0
                        ? visibleMembersOnline[index]?.toString()
                        : null,
                )
                .filter((userId): userId is string => !!userId) ?? []
        );
    }
}
