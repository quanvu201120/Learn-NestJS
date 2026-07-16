/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
    CleanupJobEntityEnum,
    CleanupJobResourceEnum,
} from '../cleanup-jobs/types/cleanup-job';
import { MediaService } from '../media/media.service';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/types/user';
import { Report, ReportDocument } from './schemas/report.schema';
import { ReportStatusEnum } from './types/report.type';

@Injectable()
export class ReportCleanupService {
    constructor(
        @InjectModel(Report.name)
        private readonly reportModel: Model<ReportDocument>,
        @Inject(forwardRef(() => UsersService))
        private readonly usersService: UsersService,
        private readonly mediaService: MediaService,
    ) {}

    /**
     * Dọn media của các report đã hết vòng đời lưu trữ và xóa/update report
     * tương ứng trong transaction trước khi xóa file vật lý trên Cloudinary.
     */
    async deleteMediasAndReportDismissed() {
        const now = new Date();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const oldReports = await this.reportModel
            .find({
                $or: [
                    {
                        status: ReportStatusEnum.RESOLVED,
                        appealDeadline: { $lt: now },
                    },
                    {
                        status: ReportStatusEnum.DISMISSED,
                        updatedAt: { $lt: thirtyDaysAgo },
                    },
                    {
                        status: ReportStatusEnum.APPEAL_SUCCESS,
                        updatedAt: { $lt: thirtyDaysAgo },
                    },
                    {
                        status: ReportStatusEnum.APPEAL_REJECTED,
                        updatedAt: { $lt: thirtyDaysAgo },
                    },
                    {
                        'snapshot.role': UserRole.SUPER_ADMIN,
                    },
                ],
            })
            .populate([
                'evidenceMediaIds',
                'appealEvidenceMediaIds',
                'snapshot.avatarMediaId',
            ]);

        if (oldReports.length === 0) return;

        const uniqueAvatars = new Map<string, any>();
        const oldReportIds = oldReports.map((r) => r._id);

        for (const report of oldReports) {
            if (report.snapshot?.avatarMediaId) {
                const avatar: any = report.snapshot.avatarMediaId;
                const avatarIdStr = avatar._id.toString();
                if (!uniqueAvatars.has(avatarIdStr)) {
                    uniqueAvatars.set(avatarIdStr, {
                        avatar,
                        targetUserId: report.targetUserId,
                    });
                }
            }
        }

        const deletableAvatarIds = new Set<string>();
        await Promise.all(
            Array.from(uniqueAvatars.entries()).map(
                async ([avatarIdStr, data]) => {
                    const targetUser = await this.usersService.findOne(
                        data.targetUserId.toString(),
                    );
                    const isStillUsing =
                        targetUser &&
                        targetUser.avatar?.toString() === avatarIdStr;

                    if (!isStillUsing) {
                        const isUsedByActiveReport =
                            await this.reportModel.exists({
                                'snapshot.avatarMediaId': data.avatar._id,
                                _id: { $nin: oldReportIds },
                            });

                        if (!isUsedByActiveReport) {
                            deletableAvatarIds.add(avatarIdStr);
                        }
                    }
                },
            ),
        );

        const checkedReports = oldReports.map((report) => {
            let shouldDeleteAvatar = false;
            if (report.snapshot?.avatarMediaId) {
                const avatarIdStr = (
                    report.snapshot.avatarMediaId as any
                )._id.toString();
                if (deletableAvatarIds.has(avatarIdStr)) {
                    shouldDeleteAvatar = true;
                }
            }
            return { report, shouldDeleteAvatar };
        });

        let validMedias: any[] = [];
        const bulkOps: any[] = [];

        for (const { report, shouldDeleteAvatar } of checkedReports) {
            const evidences = (report.evidenceMediaIds as any[]) || [];
            if (evidences.length > 0) {
                validMedias.push(...evidences.filter((m) => m != null));
            }

            const appealEvidences =
                (report.appealEvidenceMediaIds as any[]) || [];
            if (appealEvidences.length > 0) {
                validMedias.push(...appealEvidences.filter((m) => m != null));
            }

            if (shouldDeleteAvatar && report.snapshot?.avatarMediaId) {
                validMedias.push(report.snapshot.avatarMediaId as any);
            }

            if (
                report.status === ReportStatusEnum.DISMISSED ||
                report.status === ReportStatusEnum.APPEAL_SUCCESS ||
                report.snapshot?.role === UserRole.SUPER_ADMIN
            ) {
                bulkOps.push({
                    deleteOne: {
                        filter: { _id: report._id },
                    },
                });
            } else {
                const unsetPayload: any = {
                    evidenceMediaIds: 1,
                    appealEvidenceMediaIds: 1,
                };
                if (shouldDeleteAvatar) {
                    unsetPayload['snapshot.avatarMediaId'] = 1;
                }
                bulkOps.push({
                    updateOne: {
                        filter: { _id: report._id },
                        update: { $unset: unsetPayload },
                    },
                });
            }
        }

        const uniqueValidMediasMap = new Map();
        for (const media of validMedias) {
            uniqueValidMediasMap.set(media._id.toString(), media);
        }
        validMedias = Array.from(uniqueValidMediasMap.values());

        if (bulkOps.length > 0 || validMedias.length > 0) {
            const session = await this.reportModel.db.startSession();
            try {
                await session.withTransaction(async () => {
                    if (bulkOps.length > 0) {
                        await this.reportModel.bulkWrite(bulkOps, { session });
                    }
                    if (validMedias.length > 0) {
                        await Promise.all(
                            validMedias.map((media) =>
                                this.mediaService.deleteMedia(
                                    media._id.toString(),
                                    session,
                                ),
                            ),
                        );
                    }
                });
            } finally {
                await session.endSession();
            }
        }

        if (validMedias.length > 0) {
            const publicIds = validMedias.map((media) => media.publicId);
            await this.mediaService.deleteImagesFromCloudinaryWithCleanup(
                publicIds,
                {
                    resourceType: CleanupJobResourceEnum.REPORT_MEDIA,
                    entityType: CleanupJobEntityEnum.REPORT,
                },
            );
        }
    }

    async isMediaInReport(mediaId: string) {
        const count = await this.reportModel.countDocuments({
            'snapshot.avatarMediaId': mediaId,
        });
        return count > 0;
    }
}
