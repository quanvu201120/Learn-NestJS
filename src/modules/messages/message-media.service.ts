import {
    BadRequestException,
    forwardRef,
    Inject,
    Injectable,
} from '@nestjs/common';
import { Types } from 'mongoose';
import {
    MEDIA_CONSTANTS,
    MEDIA_MESSAGES,
} from '../media/constants/media.constant';
import { Media } from '../media/schemas/media.schema';
import { MediaService } from '../media/media.service';
import {
    MediaProviderEnum,
    MediaResourceTypeEnum,
    OwnerTypeEnum,
} from '../media/types/media';
import {
    CleanupJobEntityEnum,
    CleanupJobResourceEnum,
} from '../cleanup-jobs/types/cleanup-job';
import { MESSAGE_MESSAGES } from './constants/message.constant';
import { MessageEnumType } from './types/message';

@Injectable()
export class MessageMediaService {
    constructor(
        @Inject(forwardRef(() => MediaService))
        private readonly mediaService: MediaService,
    ) {}

    /**
     * Upload media của tin nhắn theo đúng provider và thư mục tương ứng với loại message.
     */
    async uploadMessageMedia(
        type: MessageEnumType,
        objectSenderId: Types.ObjectId,
        objectConversationId: Types.ObjectId,
        file?: Express.Multer.File,
    ) {
        if (
            type !== MessageEnumType.IMAGE &&
            type !== MessageEnumType.VIDEO &&
            type !== MessageEnumType.FILE &&
            type !== MessageEnumType.VOICE
        ) {
            return null;
        }

        if (!file) {
            throw new BadRequestException(MESSAGE_MESSAGES.FILE_REQUIRED);
        }

        const provider = this.getProvider(type);
        let uploadedFile: Media | null = null;

        if (provider === MediaProviderEnum.CLOUDINARY) {
            uploadedFile = await this.mediaService.uploadImageToCloudinary(
                objectSenderId,
                OwnerTypeEnum.CONVERSATION,
                objectConversationId,
                file,
                MEDIA_CONSTANTS.CONVERSATION_IMAGE_FOLDER,
            );
        } else {
            uploadedFile = await this.mediaService.uploadFileToR2(
                objectSenderId,
                OwnerTypeEnum.CONVERSATION,
                objectConversationId,
                file,
                this.getResourceType(type),
                this.getFolder(type),
            );
        }

        if (!uploadedFile) {
            throw new BadRequestException(MEDIA_MESSAGES.FILE_UPLOAD_FAILED);
        }

        return uploadedFile;
    }

    /**
     * Rollback file đã upload khi transaction tạo message hoặc media record thất bại.
     */
    async rollbackUploadedMessageMedia(uploadedFile: Media | null) {
        if (
            uploadedFile &&
            uploadedFile.publicId &&
            uploadedFile.provider === MediaProviderEnum.CLOUDINARY
        ) {
            await this.mediaService.deleteImageFromCloudinaryWithCleanup(
                uploadedFile.publicId,
                {
                    entityType: CleanupJobEntityEnum.MESSAGE,
                    resourceType: CleanupJobResourceEnum.MESSAGE_MEDIA,
                },
            );
        }
        if (
            uploadedFile &&
            uploadedFile.objectKey &&
            uploadedFile.provider === MediaProviderEnum.R2
        ) {
            await this.mediaService.deleteFileFromR2WithCleanup(
                uploadedFile.objectKey,
                {
                    entityType: CleanupJobEntityEnum.MESSAGE,
                    resourceType: CleanupJobResourceEnum.MESSAGE_MEDIA,
                },
            );
        }
    }

    private getProvider(type: MessageEnumType) {
        return type === MessageEnumType.IMAGE
            ? MediaProviderEnum.CLOUDINARY
            : MediaProviderEnum.R2;
    }

    private getResourceType(type: MessageEnumType) {
        return type === MessageEnumType.VIDEO
            ? MediaResourceTypeEnum.VIDEO
            : type === MessageEnumType.VOICE
              ? MediaResourceTypeEnum.AUDIO
              : MediaResourceTypeEnum.FILE;
    }

    private getFolder(type: MessageEnumType) {
        return type === MessageEnumType.VIDEO
            ? MEDIA_CONSTANTS.CONVERSATION_VIDEO_FOLDER
            : type === MessageEnumType.VOICE
              ? MEDIA_CONSTANTS.CONVERSATION_AUDIO_FOLDER
              : MEDIA_CONSTANTS.CONVERSATION_FILE_FOLDER;
    }
}
