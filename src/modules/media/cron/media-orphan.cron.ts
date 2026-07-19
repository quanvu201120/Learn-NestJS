import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Media, MediaDocument } from '../schemas/media.schema';
import { MediaProviderEnum } from '../types/media';
import { CloudinaryService } from '../providers/cloudinary.service';
import { R2Service } from '../providers/r2.service';

@Injectable()
export class MediaOrphanCron {
    private readonly logger = new Logger(MediaOrphanCron.name);

    constructor(
        @InjectModel(Media.name)
        private readonly mediaModel: Model<MediaDocument>,
        private readonly cloudinaryService: CloudinaryService,
        private readonly r2Service: R2Service,
    ) {}

    @Cron('0 0 2 * * *')
    async cleanupRecentOrphanMedia() {
        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        const medias = await this.mediaModel
            .find({ createdAt: { $gte: twoDaysAgo, $lte: new Date() } })
            .select('_id provider publicId objectKey')
            .lean();

        for (const media of medias) {
            try {
                const exists =
                    media.provider === MediaProviderEnum.CLOUDINARY
                        ? !!media.publicId &&
                          (await this.cloudinaryService.resourceExists(
                              media.publicId,
                          ))
                        : !!media.objectKey &&
                          (await this.r2Service.objectExists(media.objectKey));

                if (!exists) {
                    await this.mediaModel.deleteOne({ _id: media._id });
                }
            } catch (error) {
                this.logger.warn(
                    `Failed to verify media ${media._id.toString()}: ${(error as Error)?.message || error}`,
                );
            }
        }
    }
}
