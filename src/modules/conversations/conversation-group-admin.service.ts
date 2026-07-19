/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
    BadRequestException,
    Inject,
    Injectable,
    InternalServerErrorException,
    forwardRef,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { RedisService } from '@/redis/redis.service';
import {
    CleanupJobEntityEnum,
    CleanupJobResourceEnum,
} from '../cleanup-jobs/types/cleanup-job';
import { MediaService } from '../media/media.service';
import { MessagesService } from '../messages/messages.service';
import {
    MessageCreatedEvents,
    MessageEnumType,
} from '../messages/types/message';
import { RelationshipsService } from '../relationships/relationships.service';
import { UsersService } from '../users/users.service';
import { CONVERSATION_MESSAGES } from './constants/conversation.constant';
import { ConversationAccessService } from './conversation-access.service';
import { ConversationEventService } from './conversation-event.service';
import { UpdateAdminConversationResponse } from './types/conversation';
import {
    Conversation,
    ConversationDocument,
} from './schemas/conversation.schema';
import { toObjectId } from '@/utils/utils';

@Injectable()
export class ConversationGroupAdminService {
    constructor(
        @InjectModel(Conversation.name)
        private readonly conversationModel: Model<ConversationDocument>,

        @InjectConnection()
        private readonly connection: Connection,

        @Inject(forwardRef(() => MessagesService))
        private readonly messageService: MessagesService,

        @Inject(forwardRef(() => UsersService))
        private readonly userService: UsersService,

        @Inject(forwardRef(() => RedisService))
        private readonly redisService: RedisService,

        @Inject(forwardRef(() => MediaService))
        private readonly mediaService: MediaService,

        @Inject(forwardRef(() => RelationshipsService))
        private readonly relationshipsService: RelationshipsService,

        private readonly conversationAccessService: ConversationAccessService,

        private readonly conversationEventService: ConversationEventService,
    ) {}

    /**
     * Giải tán group chat cùng toàn bộ message/media liên quan, sau đó phát event realtime.
     */
    async disbandGroup(id: string, currentUserId: string) {
        const { conversation, objectConversationId } =
            await this.conversationAccessService.getConversationOrThrow(id);

        this.conversationAccessService.ensureGroupConversation(conversation);
        this.conversationAccessService.ensureGroupAdmin(
            conversation,
            currentUserId,
        );

        const session = await this.connection.startSession();
        const mediaList = {
            publicIds: [] as string[],
            objectKeys: [] as string[],
        };

        try {
            await session.withTransaction(async () => {
                const getMedia =
                    await this.mediaService.getMediaCleanupKeysByConversation(
                        conversation._id.toString(),
                        session,
                    );
                mediaList.publicIds = getMedia.listPublicId;
                mediaList.objectKeys = getMedia.listObjectKey;

                await this.messageService.deleteMessagesByConversationId(
                    id,
                    session,
                );
                await this.mediaService.deleteAllMediaByConversation(
                    id,
                    session,
                );
                await this.conversationModel.findByIdAndDelete(
                    objectConversationId,
                    { session },
                );
            });
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (error) {
            throw new InternalServerErrorException(
                CONVERSATION_MESSAGES.DELETE_FAILED,
            );
        } finally {
            await session.endSession();
        }

        await this.redisService
            .removeAllUnseenConversationWithCleanup(conversation.users, id)
            .catch((error) => {
                console.error('Remove all unseen conversation failed', error);
            });

        if (mediaList.objectKeys && mediaList.objectKeys.length > 0) {
            await this.mediaService.deleteFilesFromR2WithCleanup(
                mediaList.objectKeys,
                {
                    entityType: CleanupJobEntityEnum.CONVERSATION,
                    entityId: conversation._id.toString(),
                    resourceType: CleanupJobResourceEnum.CONVERSATION_MEDIA,
                },
            );
        }

        if (mediaList.publicIds && mediaList.publicIds.length > 0) {
            await this.mediaService.deleteImagesFromCloudinaryWithCleanup(
                mediaList.publicIds,
                {
                    entityType: CleanupJobEntityEnum.CONVERSATION,
                    entityId: conversation._id.toString(),
                    resourceType: CleanupJobResourceEnum.CONVERSATION_MEDIA,
                },
            );
        }

        this.conversationEventService.conversationDisbanded$.next({
            conversationId: id,
            memberIds: conversation.users.map((user) => user.toString()),
        });

        return { message: CONVERSATION_MESSAGES.DELETE_SUCCESS };
    }

    /**
     * Chuyển quyền trưởng nhóm, ghi system message trong transaction và emit event cho member online.
     */
    async changeAdminGroup(
        currentUserId: string,
        newAdminId: string,
        conversationId: string,
    ) {
        const { conversation, objectConversationId } =
            await this.conversationAccessService.getConversationOrThrow(
                conversationId,
            );

        this.conversationAccessService.ensureGroupConversation(conversation);
        this.conversationAccessService.ensureGroupAdmin(
            conversation,
            currentUserId,
        );
        this.conversationAccessService.ensureMemberInConversation(
            conversation,
            newAdminId,
        );
        this.conversationAccessService.ensureMemberAcceptedConversation(
            conversation,
            newAdminId,
        );

        await this.userService.checkUser(newAdminId, true, true, true);

        const relationshipBlock =
            await this.relationshipsService.checkIsBlocked(
                currentUserId,
                newAdminId,
            );
        if (relationshipBlock) {
            throw new BadRequestException(
                CONVERSATION_MESSAGES.CHANGE_ADMIN_FAILED,
            );
        }

        if (currentUserId === newAdminId) {
            throw new BadRequestException(
                CONVERSATION_MESSAGES.CURRENT_USER_IS_ALREADY_ADMIN,
            );
        }

        const objectNewAdminId = toObjectId(newAdminId, 'new admin id');
        const session = await this.connection.startSession();
        let result: any = null;
        let messageEvents: MessageCreatedEvents | undefined;
        try {
            await session.withTransaction(async () => {
                result = await this.conversationModel
                    .findByIdAndUpdate(
                        objectConversationId,
                        { $set: { adminGroupId: objectNewAdminId } },
                        { returnDocument: 'after', session },
                    )
                    .populate('users', 'name _id')
                    .lean();

                if (!result) {
                    throw new BadRequestException(
                        CONVERSATION_MESSAGES.CONVERSATION_NOT_FOUND,
                    );
                }

                const currentUserObj = result.users.find(
                    (u: any) => u._id.toString() === currentUserId,
                );
                const newAdminObj = result.users.find(
                    (u: any) => u._id.toString() === newAdminId,
                );
                const currentName =
                    (currentUserObj as any)?.name ||
                    CONVERSATION_MESSAGES.ADMIN_LABEL;
                const newName =
                    (newAdminObj as any)?.name ||
                    CONVERSATION_MESSAGES.MEMBER_LABEL;

                const createdMessage = await this.messageService.createMessage(
                    currentUserId,
                    conversationId,
                    MessageEnumType.SYSTEM,
                    CONVERSATION_MESSAGES.SYSTEM_TRANSFER_ADMIN(
                        currentName,
                        newName,
                    ),
                    undefined,
                    undefined,
                    session,
                );
                messageEvents = createdMessage.events;
            });
        } finally {
            await session.endSession();
        }

        this.messageService.emitCreatedMessageEvents(messageEvents);
        const userIds = result.users.map((u: any) => u._id.toString());
        const membersOnline =
            await this.redisService.getUserOnlineInListIds(userIds);
        if (membersOnline.length > 0) {
            this.conversationEventService.conversationAdminChanged$.next({
                conversationId,
                newAdminId,
                membersOnline: membersOnline.map((userId) => userId.toString()),
            });
        }
        const res: UpdateAdminConversationResponse = {
            updated: true,
        };
        return res;
    }
}
