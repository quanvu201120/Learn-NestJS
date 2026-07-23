/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { RelationshipsService } from '../relationships/relationships.service';
import { serializeMedia } from '../media/utils/media.serializer';
import { serializeMessage } from '../messages/utils/message.serializer';
import { serializeUser } from '../users/utils/user.serializer';
import { ConversationResponse } from './types/conversation';

@Injectable()
export class ConversationSerializerService {
    constructor(
        @Inject(forwardRef(() => RelationshipsService))
        private readonly relationshipsService: RelationshipsService,
    ) {}

    /**
     * Helper nội bộ: Format dữ liệu conversation trước khi trả về client.
     * Chuyển đổi ID của lastMessage thành object nếu đã được populate.
     */
    async serializeConversation(
        conversation: any,
        currentUserId?: string,
        preloadedHiddenUserIds?: string[],
        checkHiddenUserBlock = false,
    ): Promise<ConversationResponse> {
        const { lastMessageId, pinMessageId, avatar, users, ...rest } =
            conversation;

        const processedUsers = users;

        const hiddenUserIds =
            preloadedHiddenUserIds !== undefined
                ? preloadedHiddenUserIds
                : currentUserId && Array.isArray(processedUsers)
                  ? await this.relationshipsService.getBlockedUserIdsAmongUsers(
                        currentUserId,
                        processedUsers.map((user: any) => user._id.toString()),
                    )
                  : [];
        const hiddenUserIdSet = new Set(hiddenUserIds);

        return {
            ...rest,
            users: processedUsers?.map((user: any) =>
                serializeUser(
                    user,
                    true,
                    checkHiddenUserBlock &&
                        hiddenUserIdSet.has(user._id.toString()),
                ),
            ),
            avatar: avatar ? serializeMedia(avatar) : avatar,
            lastMessage: lastMessageId
                ? typeof lastMessageId === 'object' && '_id' in lastMessageId
                    ? serializeMessage(lastMessageId, hiddenUserIds)
                    : lastMessageId
                : undefined,
            pinMessage: pinMessageId
                ? typeof pinMessageId === 'object' && '_id' in pinMessageId
                    ? serializeMessage(pinMessageId, hiddenUserIds)
                    : pinMessageId
                : undefined,
        };
    }
}
