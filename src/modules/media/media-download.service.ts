/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
    BadRequestException,
    forwardRef,
    ForbiddenException,
    Inject,
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
import { RelationshipsService } from '../relationships/relationships.service';
import { MEDIA_MESSAGES } from './constants/media.constant';
import { MediaDocument } from './schemas/media.schema';
import { MediaProviderEnum, OwnerTypeEnum } from './types/media';
import { MEDIA_CONSTANTS } from './constants/media.constant';
import { serializeMedia } from './utils/media.serializer';
import { MediaPersistenceService } from './media-persistence.service';
import { MediaStorageService } from './media-storage.service';

@Injectable()
export class MediaDownloadService {
    constructor(
        @InjectModel(Conversation.name)
        private conversationModel: Model<ConversationDocument>,
        private readonly mediaPersistenceService: MediaPersistenceService,
        private readonly mediaStorageService: MediaStorageService,
        @Inject(forwardRef(() => RelationshipsService))
        private readonly relationshipsService: RelationshipsService,
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

    /**
     * Cấp lại URL (đã ký nếu là media riêng tư) cho một media sau khi kiểm tra
     * quyền truy cập. Dùng khi signed URL cũ hết hạn và client cần xin vé mới.
     */
    async getMediaUrl(id: string, userId: string) {
        const media = await this.mediaPersistenceService.findById(id);

        if (!media) {
            throw new NotFoundException(MEDIA_MESSAGES.MEDIA_NOT_FOUND);
        }

        await this.assertMediaAccess(media, userId);

        const serialized = serializeMedia(media.toObject());
        const url =
            serialized && typeof serialized === 'object'
                ? serialized.url
                : undefined;

        if (!url) {
            throw new BadRequestException(MEDIA_MESSAGES.MEDIA_URL_UNAVAILABLE);
        }

        const expiresAt = new Date(
            Date.now() + MEDIA_CONSTANTS.SIGNED_URL_TTL_SECONDS * 1000,
        ).toISOString();

        return { url, expiresAt };
    }

    /**
     * Kiểm tra user hiện tại có quyền truy cập media hay không.
     * - Chặn media đã soft delete.
     * - Với media của user: chỉ owner hoặc người upload được phép tải.
     * - Với media của conversation: phải thuộc conversation và không bị block.
     */
    private async assertMediaAccess(media: MediaDocument, userId: string) {
        const objectUserId = toObjectId(userId, 'user id');

        // Media đã xoá mềm (xoá tin nhắn) không được phục vụ lại dù còn giữ id.
        if (media.isDeleted) {
            throw new NotFoundException(MEDIA_MESSAGES.MEDIA_NOT_FOUND);
        }

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

            // Không cho tải file do người mà mình đã block (hoặc đã block mình),
            // đồng bộ với cách getMediasByConversation ẩn media của người bị block.
            const uploaderId = media.uploadedBy?.toString();
            if (uploaderId && uploaderId !== objectUserId.toString()) {
                const isBlocked =
                    await this.relationshipsService.checkIsBlocked(
                        userId,
                        uploaderId,
                    );
                if (isBlocked) {
                    throw new ForbiddenException(
                        MEDIA_MESSAGES.MEDIA_ACCESS_DENIED,
                    );
                }
            }
            return;
        }

        throw new BadRequestException(MEDIA_MESSAGES.OWNER_TYPE_NOT_SUPPORT);
    }
}
