/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
    forwardRef,
    Inject,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { GLOBAL_CONSTANTS } from '@/common/constants/global.constant';
import { parseDateOrThrow, toObjectId } from '@/utils/utils';
import { CONVERSATION_MESSAGES } from '../conversations/constants/conversation.constant';
import {
    Conversation,
    ConversationDocument,
} from '../conversations/schemas/conversation.schema';
import { RelationshipsService } from '../relationships/relationships.service';
import { Media, MediaDocument } from './schemas/media.schema';
import {
    ListMediaResponse,
    MediaResourceTypeEnum,
    MediaResponse,
    OwnerTypeEnum,
} from './types/media';
import { serializeMedia } from './utils/media.serializer';

@Injectable()
export class MediaQueryService {
    constructor(
        @InjectModel(Media.name) private mediaModel: Model<MediaDocument>,
        @InjectModel(Conversation.name)
        private conversationModel: Model<ConversationDocument>,
        @Inject(forwardRef(() => RelationshipsService))
        private readonly relationshipsService: RelationshipsService,
    ) {}

    async getMediasByConversation(
        conversationId: string,
        userId: string,
        type: MediaResourceTypeEnum,
        cursor?: string,
        session?: ClientSession,
    ) {
        const objectConversationId = toObjectId(
            conversationId,
            'conversation id',
        );
        const objectUserId = toObjectId(userId, 'user id');

        const query = this.conversationModel
            .findOne({
                _id: objectConversationId,
                users: objectUserId,
            })
            .select('_id hiddenHistory users');

        if (session) {
            query.session(session);
        }
        const conversation = await query.lean();

        if (!conversation) {
            throw new NotFoundException(
                CONVERSATION_MESSAGES.CONVERSATION_NOT_FOUND,
            );
        }

        const userHidden = conversation.hiddenHistory?.find(
            (item) => item?.userId?.toString() === objectUserId.toString(),
        );

        const createdAtFilter: Record<string, Date> = {};
        if (cursor) {
            createdAtFilter.$lt = parseDateOrThrow(cursor, 'cursor');
        }
        if (userHidden?.hiddenAt) {
            createdAtFilter.$gte = userHidden.hiddenAt;
        }

        const blockedUserIds =
            await this.relationshipsService.getBlockedUserIdsAmongUsers(
                userId,
                Array.isArray(conversation.users)
                    ? conversation.users
                          .map((item: any) => item?.toString())
                          .filter((item): item is string => !!item)
                    : [],
            );

        const mediaQuery = this.mediaModel.find({
            ownerId: objectConversationId,
            ownerType: OwnerTypeEnum.CONVERSATION,
            resourceType: type,
            isDeleted: { $ne: true },
            ...(blockedUserIds.length > 0
                ? {
                      uploadedBy: {
                          $nin: blockedUserIds.map((blockedUserId) =>
                              toObjectId(blockedUserId, 'blocked user id'),
                          ),
                      },
                  }
                : {}),
            ...(Object.keys(createdAtFilter).length > 0
                ? { createdAt: createdAtFilter }
                : {}),
        });

        if (session) {
            mediaQuery.session(session);
        }

        const medias = await mediaQuery
            .sort({ createdAt: -1, _id: -1 })
            .limit(GLOBAL_CONSTANTS.LIMIT_MEDIAS_DEFAULT)
            .lean();

        if (medias.length === 0) {
            return { nextCursor: null, medias: [] } as ListMediaResponse;
        }

        const formattedMedias: MediaResponse[] = medias.map((media) =>
            serializeMedia(media),
        );

        const hasNextPage =
            formattedMedias.length === GLOBAL_CONSTANTS.LIMIT_MEDIAS_DEFAULT;
        const lastMedia = formattedMedias[formattedMedias.length - 1];
        const nextCursor =
            hasNextPage && lastMedia?.createdAt
                ? new Date(lastMedia.createdAt).toISOString()
                : null;

        return { nextCursor, medias: formattedMedias };
    }
}
