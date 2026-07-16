import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { toObjectId } from '@/utils/utils';
import {
    Conversation,
    ConversationDocument,
} from '../conversations/schemas/conversation.schema';
import { MEDIA_MESSAGES } from './constants/media.constant';
import { MediaDocument } from './schemas/media.schema';
import { MediaProviderEnum, OwnerTypeEnum } from './types/media';
import { MediaPersistenceService } from './media-persistence.service';
import { MediaStorageService } from './media-storage.service';

@Injectable()
export class MediaDownloadService {
    constructor(
        @InjectModel(Conversation.name)
        private conversationModel: Model<ConversationDocument>,
        private readonly mediaPersistenceService: MediaPersistenceService,
        private readonly mediaStorageService: MediaStorageService,
    ) {}

    /**
     * Download file media từ R2 theo id và kiểm tra quyền truy cập.
     */
    async downloadR2Media(id: string, userId: string) {
        const media = await this.mediaPersistenceService.findById(id);

        if (!media) {
            throw new NotFoundException(MEDIA_MESSAGES.MEDIA_NOT_FOUND);
        }

        await this.assertMediaAccess(media, userId);

        if (media.provider !== MediaProviderEnum.R2 || !media.objectKey) {
            throw new BadRequestException(
                MEDIA_MESSAGES.MEDIA_NOT_STORED_IN_R2,
            );
        }

        const result = await this.mediaStorageService.getR2Object(
            media.objectKey,
        );
        const bytes = await result.Body?.transformToByteArray();

        if (!bytes) {
            throw new NotFoundException(MEDIA_MESSAGES.MEDIA_CONTENT_NOT_FOUND);
        }

        return {
            buffer: Buffer.from(bytes),
            fileName: media.fileName || 'download',
            mimeType: media.mimeType || 'application/octet-stream',
        };
    }

    private async assertMediaAccess(media: MediaDocument, userId: string) {
        const objectUserId = toObjectId(userId, 'user id');

        if (media.ownerType === OwnerTypeEnum.USER) {
            const ownerId = media.ownerId?.toString();
            const uploadedBy = media.uploadedBy?.toString();
            if (
                ownerId !== objectUserId.toString() &&
                uploadedBy !== objectUserId.toString()
            ) {
                throw new ForbiddenException(
                    MEDIA_MESSAGES.MEDIA_ACCESS_DENIED,
                );
            }
            return;
        }

        if (media.ownerType === OwnerTypeEnum.CONVERSATION) {
            const hasAccess = await this.conversationModel.exists({
                _id: media.ownerId,
                users: objectUserId,
            });

            if (!hasAccess) {
                throw new ForbiddenException(
                    MEDIA_MESSAGES.MEDIA_ACCESS_DENIED,
                );
            }
        }
    }
}
