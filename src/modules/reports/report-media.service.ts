/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import {
    CleanupJobEntityEnum,
    CleanupJobResourceEnum,
} from '../cleanup-jobs/types/cleanup-job';
import { MEDIA_CONSTANTS } from '../media/constants/media.constant';
import { MediaDocument } from '../media/schemas/media.schema';
import { MediaService } from '../media/media.service';
import { OwnerTypeEnum } from '../media/types/media';

@Injectable()
export class ReportMediaService {
    constructor(private readonly mediaService: MediaService) {}

    /**
     * Upload các ảnh bằng chứng của report lên Cloudinary và tạo media document
     * tương ứng trong database. Nếu một ảnh upload hoặc lưu DB lỗi, các media
     * đã tạo trước đó sẽ được rollback.
     */
    async uploadEvidenceImages(
        reporterId: string,
        files: Express.Multer.File[],
    ) {
        if (!files.length) {
            return [];
        }

        const objectReporterId = new Types.ObjectId(reporterId);

        const results = await Promise.all(
            files.map(async (file) => {
                let publicId = '';

                try {
                    const uploadedMedia =
                        await this.mediaService.uploadImageToCloudinary(
                            objectReporterId,
                            OwnerTypeEnum.USER,
                            objectReporterId,
                            file,
                            MEDIA_CONSTANTS.REPORT_EVIDENCE_FOLDER,
                        );
                    publicId = uploadedMedia.publicId!;
                    const createdMedia =
                        await this.mediaService.createMedia(uploadedMedia);

                    return { createdMedia, publicId, error: null };
                } catch (error) {
                    return {
                        createdMedia: null,
                        publicId,
                        error,
                    };
                }
            }),
        );

        const failedResult = results.find((result) => result.error);
        const uploadedMedias = results
            .filter((result) => result.createdMedia)
            .map((result) => result.createdMedia as MediaDocument);

        if (!failedResult) {
            return uploadedMedias;
        }

        const orphanPublicIds = results
            .filter((result) => result.publicId && !result.createdMedia)
            .map((result) => result.publicId);

        if (orphanPublicIds.length > 0) {
            await this.mediaService
                .deleteImagesFromCloudinaryWithCleanup(orphanPublicIds, {
                    entityType: CleanupJobEntityEnum.REPORT,
                    resourceType: CleanupJobResourceEnum.REPORT_MEDIA,
                })
                .catch(() => false);
        }

        await this.rollbackEvidenceImages(uploadedMedias);
        throw failedResult.error;
    }

    /**
     * Rollback media bằng chứng đã upload khi create report hoặc appeal thất bại:
     * xóa media document trước, sau đó xóa file Cloudinary kèm cleanup job nếu cần.
     */
    async rollbackEvidenceImages(uploadedMediaDocs: MediaDocument[]) {
        await Promise.allSettled(
            uploadedMediaDocs.map((media) =>
                this.mediaService.deleteMedia(media._id.toString()),
            ),
        );

        if (uploadedMediaDocs.length === 0) {
            return;
        }

        const publicIds = uploadedMediaDocs
            .filter((media) => !!media.publicId)
            .map((media) => media.publicId as string);

        if (publicIds.length > 0) {
            await this.mediaService
                .deleteImagesFromCloudinaryWithCleanup(publicIds, {
                    entityType: CleanupJobEntityEnum.REPORT,
                    resourceType: CleanupJobResourceEnum.REPORT_MEDIA,
                })
                .catch(() => false);
        }
    }
}
