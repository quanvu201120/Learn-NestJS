import { forwardRef, Module } from '@nestjs/common';
import { MediaService } from './media.service';
import { CloudinaryService } from './providers/cloudinary.service';
import { R2Service } from './providers/r2.service';
import { MongooseModule } from '@nestjs/mongoose';
import { Media, MediaSchema } from './schemas/media.schema';
import { CleanupJobsModule } from '../cleanup-jobs/cleanup-jobs.module';
import { RelationshipsModule } from '../relationships/relationships.module';
import {
    Conversation,
    ConversationSchema,
} from '../conversations/schemas/conversation.schema';
import { MediaController } from './media.controller';
import { MediaStorageService } from './media-storage.service';
import { MediaPersistenceService } from './media-persistence.service';
import { MediaCleanupService } from './media-cleanup.service';
import { MediaQueryService } from './media-query.service';
import { MediaDownloadService } from './media-download.service';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Media.name, schema: MediaSchema },
            { name: Conversation.name, schema: ConversationSchema },
        ]),
        forwardRef(() => CleanupJobsModule),
        forwardRef(() => RelationshipsModule),
    ],
    controllers: [MediaController],
    providers: [
        MediaService,
        MediaStorageService,
        MediaPersistenceService,
        MediaCleanupService,
        MediaQueryService,
        MediaDownloadService,
        CloudinaryService,
        R2Service,
    ],
    exports: [MediaService, CloudinaryService, R2Service],
})
export class MediaModule {}
