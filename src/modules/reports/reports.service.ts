/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-return */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import {
    BadRequestException,
    ForbiddenException,
    Inject,
    Injectable,
    Logger,
    forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Report, ReportDocument } from './schemas/report.schema';
import { CreateReportDto } from './dto/create-report.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { GetReportsDto } from './dto/get-reports.dto';
import { ManualBanDto } from './dto/manual-ban.dto';
import { QuickPenaltyDto } from './dto/quick-penalty.dto';
import { AppealReportDto } from './dto/appeal-report.dto';
import { AdminActionWithPasswordDto } from '@/modules/users/dto/update-user.dto';
import { UsersService } from '../users/users.service';
import { SessionService } from '../session/session.service';
import {
    PenaltyTypeEnum,
    ReportReasonEnum,
    ReportStatusEnum,
} from './types/report.type';
import { toObjectId, validateObjectId } from '@/utils/utils';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
    AuditLogActionEnum,
    AuditLogTargetEnum,
} from '../audit-log/types/audit-log.type';
import { UserRole } from '../users/types/user';
import { REPORT_CONSTANTS, REPORT_MESSAGES } from './constants/report.constant';
import { Media } from '../media/schemas/media.schema';
import { NotificationTypeEnum } from '../notifications/types/notification.type';
import { NOTIFICATION_TITLES } from '../notifications/constants/notification.constant';
import { ReportAdminActionService } from './report-admin-action.service';
import { ReportAppealService } from './report-appeal.service';
import { ReportCleanupService } from './report-cleanup.service';
import { ReportMediaService } from './report-media.service';
import { ReportPenaltyService } from './report-penalty.service';
import { ReportQueryService } from './report-query.service';

@Injectable()
export class ReportsService {
    private readonly logger = new Logger(ReportsService.name);

    constructor(
        @InjectModel(Report.name) private reportModel: Model<ReportDocument>,
        @Inject(forwardRef(() => UsersService))
        private readonly usersService: UsersService,
        private readonly sessionService: SessionService,
        private readonly reportAdminActionService: ReportAdminActionService,
        private readonly reportAppealService: ReportAppealService,
        private readonly reportCleanupService: ReportCleanupService,
        private readonly reportMediaService: ReportMediaService,
        private readonly reportPenaltyService: ReportPenaltyService,
        private readonly reportQueryService: ReportQueryService,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    /**
     * Tìm report đại diện cho án ban đang chặn đăng nhập của user.
     *
     * Method này chỉ phục vụ flow login bị ban, nên chỉ xét các report có dấu
     * hiệu đang áp dụng hình phạt khóa tài khoản.
     */
    async findCurrentAppealContextByUserId(userId: string) {
        return await this.reportQueryService.findCurrentAppealContextByUserId(
            userId,
        );
    }

    /**
     * Sinh JWT ngắn hạn chỉ dùng cho flow kháng cáo một report cụ thể.
     *
     * Token này không thay thế access token của app và chỉ hợp lệ với scope
     * `report_appeal`.
     */
    async generateAppealToken(userId: string, reportId: string) {
        return await this.reportAppealService.generateAppealToken(
            userId,
            reportId,
        );
    }

    /**
     * Tạo report mới, kiểm tra target user, giới hạn số report theo ngày và
     * lưu snapshot thông tin user tại thời điểm bị report.
     */
    async create(
        createReportDto: CreateReportDto,
        reporterId: string,
        files: Express.Multer.File[] = [],
    ) {
        const objectReporterId = toObjectId(reporterId, 'reporterId');
        const objectTargetUserId = toObjectId(
            createReportDto.targetUserId,
            'targetUserId',
        );

        if (reporterId === createReportDto.targetUserId) {
            throw new BadRequestException(REPORT_MESSAGES.CANNOT_REPORT_SELF);
        }

        const reporter = await this.usersService.findOne(reporterId);
        const isAdmin =
            reporter &&
            (reporter.role === UserRole.ADMIN ||
                reporter.role === UserRole.SUPER_ADMIN);

        if (!isAdmin) {
            // Validate rate limit: Max 3 reports per 24h from this reporter to this target
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const reportCount = await this.reportModel.countDocuments({
                reporterId: objectReporterId,
                targetUserId: objectTargetUserId,
                createdAt: { $gte: oneDayAgo },
            });

            if (reportCount >= REPORT_CONSTANTS.REPORT_LIMIT_PER_DAY_DEFAULT) {
                throw new BadRequestException(REPORT_MESSAGES.TOO_MANY_REPORTS);
            }
        }

        const targetUser = await this.usersService.findOne(
            createReportDto.targetUserId,
        );
        if (!targetUser) {
            throw new BadRequestException(
                REPORT_MESSAGES.TARGET_USER_NOT_FOUND,
            );
        }

        const uploadedMediaDocs =
            await this.reportMediaService.uploadEvidenceImages(
                reporterId,
                files,
            );

        try {
            const report = new this.reportModel({
                ...createReportDto,
                evidenceMediaIds: uploadedMediaDocs.map((media) => media._id),
                reporterId: objectReporterId,
                targetUserId: objectTargetUserId,
                snapshot: {
                    avatarMediaId: targetUser.avatar,
                    displayName: targetUser.name,
                    bio: targetUser.bio,
                    role: targetUser.role,
                },
                status: ReportStatusEnum.PENDING,
                description:
                    createReportDto.reason === ReportReasonEnum.OTHER
                        ? createReportDto.description
                        : createReportDto.optionalDescription,
            });

            await report.save();
            return {
                message: REPORT_MESSAGES.REPORT_SUBMITTED_SUCCESS,
                report,
            };
        } catch (error) {
            await this.reportMediaService.rollbackEvidenceImages(
                uploadedMediaDocs,
            );
            throw error;
        }
    }

    async findAll(query: GetReportsDto) {
        return await this.reportQueryService.findAll(query);
    }

    async findByIdForApi(id: string) {
        return await this.reportQueryService.findByIdForApi(id);
    }

    async findOne(id: string) {
        return await this.reportQueryService.findOne(id);
    }

    /**
     * Nhận đơn kháng cáo bằng appeal token thay vì access token đăng nhập.
     *
     * Flow này cho phép user bị ban vẫn có thể gửi kháng cáo khi FE đã nhận
     * được appeal token từ login response hoặc từ endpoint cấp quyền kháng cáo.
     */
    async appeal(
        id: string,
        authorization: string | undefined,
        appealDto: AppealReportDto,
        files: Express.Multer.File[] = [],
    ) {
        return await this.reportAppealService.appeal(
            id,
            authorization,
            appealDto,
            files,
        );
    }

    /**
     * Cấp appeal token cho user đang ở trong app và đã chọn đúng report muốn
     * kháng cáo từ notification hoặc màn hình chi tiết.
     */
    async getAppealAccess(id: string, userId: string) {
        return await this.reportAppealService.getAppealAccess(id, userId);
    }

    async calculatePenaltyInfo(targetUserId: string, reason: ReportReasonEnum) {
        return await this.reportPenaltyService.calculatePenaltyInfo(
            targetUserId,
            reason,
        );
    }

    async resolve(
        id: string,
        resolveDto: ResolveReportDto,
        adminId: string,
        adminRole: UserRole,
        req: any,
    ) {
        validateObjectId(id, 'reportId');
        const report = await this.reportModel.findById(id);

        if (!report) {
            throw new BadRequestException(REPORT_MESSAGES.REPORT_NOT_FOUND);
        }

        if (report.status === ReportStatusEnum.RESOLVING) {
            throw new BadRequestException(
                REPORT_MESSAGES.REPORT_IS_BEING_PROCESSED,
            );
        }

        if (
            report.status !== ReportStatusEnum.PENDING &&
            report.status !== ReportStatusEnum.APPEAL_PENDING
        ) {
            throw new BadRequestException(
                REPORT_MESSAGES.REPORT_ALREADY_RESOLVED,
            );
        }

        if (
            report.status === ReportStatusEnum.PENDING &&
            !(
                resolveDto.status === ReportStatusEnum.RESOLVED ||
                resolveDto.status === ReportStatusEnum.DISMISSED
            )
        ) {
            throw new BadRequestException(
                REPORT_MESSAGES.REPORT_INVALID_STATUS,
            );
        }

        if (
            report.status === ReportStatusEnum.APPEAL_PENDING &&
            !(
                resolveDto.status === ReportStatusEnum.APPEAL_REJECTED ||
                resolveDto.status === ReportStatusEnum.APPEAL_SUCCESS
            )
        ) {
            throw new BadRequestException(
                REPORT_MESSAGES.REPORT_INVALID_STATUS,
            );
        }

        const isSuperAdminReport =
            report.snapshot?.role === UserRole.SUPER_ADMIN;
        const adminNote = resolveDto.adminNote?.trim();
        const normalizedAdminNote =
            resolveDto.status === ReportStatusEnum.DISMISSED &&
            isSuperAdminReport &&
            !adminNote
                ? REPORT_MESSAGES.SUPER_ADMIN_DISMISS_NOTE
                : adminNote;

        const originalStatus = report.status;
        const claimedReport = await this.reportModel.findOneAndUpdate(
            { _id: report._id, status: report.status },
            {
                $set: {
                    status: ReportStatusEnum.RESOLVING,
                },
            },
            { returnDocument: 'after' },
        );

        if (!claimedReport) {
            throw new BadRequestException(
                REPORT_MESSAGES.REPORT_ALREADY_RESOLVED,
            );
        }

        const session = await this.reportModel.db.startSession();
        let finalReport = claimedReport;
        let banUntil: Date | undefined;
        let muteUntil: Date | undefined;

        try {
            await session.withTransaction(async () => {
                const claimedInTx = await this.reportModel.findOneAndUpdate(
                    { _id: report._id, status: ReportStatusEnum.RESOLVING },
                    {
                        $set: {
                            status: resolveDto.status,
                            adminNote: normalizedAdminNote,
                            resolvedBy: new Types.ObjectId(adminId),
                            resolvedAt: new Date(),
                        },
                    },
                    { returnDocument: 'after', session },
                );

                if (!claimedInTx) {
                    throw new BadRequestException(
                        REPORT_MESSAGES.REPORT_ALREADY_RESOLVED,
                    );
                }

                finalReport = claimedInTx;

                if (resolveDto.status === ReportStatusEnum.RESOLVED) {
                    const penaltyResult =
                        await this.reportPenaltyService.calculateAndApplyPenalty(
                            report.targetUserId.toString(),
                            report.reason,
                            adminId,
                            adminRole,
                            resolveDto.overridePenaltyAction,
                            resolveDto.overridePenaltyDurationDays,
                            resolveDto.resetAvatar,
                            resolveDto.resetBio,
                            resolveDto.resetName,
                            session,
                        );

                    finalReport.penaltyApplied =
                        penaltyResult.penaltyAppliedStr;
                    finalReport.penaltyType = penaltyResult.penaltyType;
                    finalReport.appealDeadline = new Date(
                        Date.now() + 30 * 24 * 60 * 60 * 1000,
                    );
                    banUntil = penaltyResult.banUntil;
                    muteUntil = penaltyResult.muteUntil;

                    await this.reportModel.updateOne(
                        { _id: finalReport._id },
                        {
                            $set: {
                                penaltyApplied: finalReport.penaltyApplied,
                                penaltyType: finalReport.penaltyType,
                                appealDeadline: finalReport.appealDeadline,
                            },
                        },
                        { session },
                    );

                    await this.reportModel.updateMany(
                        {
                            targetUserId: report.targetUserId,
                            reason: report.reason,
                            status: ReportStatusEnum.PENDING,
                            _id: { $ne: report._id },
                        },
                        {
                            $set: {
                                status: ReportStatusEnum.DISMISSED,
                                adminNote:
                                    'Đã xử lý gộp chung với báo cáo #' +
                                    report._id.toString(),
                                resolvedBy: new Types.ObjectId(adminId),
                                resolvedAt: new Date(),
                            },
                        },
                        { session },
                    );
                } else if (
                    resolveDto.status === ReportStatusEnum.APPEAL_SUCCESS
                ) {
                    const targetUser = await this.usersService.findOne(
                        report.targetUserId.toString(),
                    );
                    const penaltyType = finalReport.penaltyType;

                    if (targetUser && penaltyType === PenaltyTypeEnum.BAN) {
                        targetUser.banUntil = undefined;
                        await targetUser.save({ session });
                    } else if (
                        targetUser &&
                        penaltyType === PenaltyTypeEnum.MUTE
                    ) {
                        targetUser.muteUntil = undefined;
                        await targetUser.save({ session });
                    }

                    await this.reportModel.updateOne(
                        { _id: finalReport._id },
                        {
                            $set: {
                                status: ReportStatusEnum.APPEAL_SUCCESS,
                            },
                        },
                        { session },
                    );
                }
            });
        } catch (error) {
            await this.reportModel.updateOne(
                { _id: report._id, status: ReportStatusEnum.RESOLVING },
                {
                    $set: { status: originalStatus },
                    $unset: {
                        resolvedBy: '',
                        resolvedAt: '',
                        penaltyApplied: '',
                        penaltyType: '',
                        appealDeadline: '',
                    },
                },
            );
            await session.endSession();
            throw error;
        }

        await session.endSession();

        if (
            resolveDto.status === ReportStatusEnum.RESOLVED &&
            banUntil &&
            banUntil > new Date()
        ) {
            await this.sessionService.revokeAllByUserIdWithCleanup(
                report.targetUserId.toString(),
            );
            this.eventEmitter.emit('user.banned', {
                userId: report.targetUserId.toString(),
                banUntil,
            });
        }

        if (
            resolveDto.status === ReportStatusEnum.RESOLVED &&
            muteUntil &&
            muteUntil > new Date()
        ) {
            this.eventEmitter.emit('user.muted', {
                userId: report.targetUserId.toString(),
                muteUntil,
            });
        }

        if (
            resolveDto.status === ReportStatusEnum.APPEAL_SUCCESS &&
            finalReport.penaltyType === PenaltyTypeEnum.MUTE
        ) {
            this.eventEmitter.emit('user.unmuted', {
                userId: report.targetUserId.toString(),
            });
        }

        if (resolveDto.status !== ReportStatusEnum.DISMISSED) {
            const notificationType =
                resolveDto.status === ReportStatusEnum.APPEAL_REJECTED
                    ? NotificationTypeEnum.REPORT_APPEAL_REJECTED
                    : resolveDto.status === ReportStatusEnum.APPEAL_SUCCESS
                      ? NotificationTypeEnum.REPORT_APPEAL_SUCCESS
                      : NotificationTypeEnum.REPORT_RESOLVED;

            this.eventEmitter.emit('notification.create', {
                userId: report.targetUserId.toString(),
                type: notificationType,
                title: NOTIFICATION_TITLES[notificationType],
                refId: finalReport._id.toString(),
                snapshot: {
                    avatarMediaId: report.snapshot?.avatarMediaId,
                    displayName: report.snapshot?.displayName,
                    bio: report.snapshot?.bio,
                    role: report.snapshot?.role,
                },
                metadata: {
                    reportStatus: finalReport.status,
                    reason: report.reason,
                    penaltyApplied: finalReport.penaltyApplied,
                    penaltyType: finalReport.penaltyType,
                    appealDeadline: finalReport.appealDeadline,
                    appealReviewDeadline: finalReport.appealReviewDeadline,
                },
            });
        }

        this.eventEmitter.emit('audit.log.create', {
            req,
            actorId: adminId,
            actorRole: adminRole,
            action: AuditLogActionEnum.RESOLVE_REPORT,
            targetId: finalReport._id.toString(),
            targetType: AuditLogTargetEnum.REPORT,
            metadata: {
                rp_status: resolveDto.status,
                rp_penaltyApplied: finalReport.penaltyApplied,
                rp_adminNote: normalizedAdminNote,
                rp_reporterId: report.reporterId,
                rp_targetUserId: report.targetUserId,
                rp_description: report.description,
                rp_reason: report.reason,
                oldAvatar: report.snapshot?.avatarMediaId,
                oldName: report.snapshot?.displayName,
                oldBio: report.snapshot?.bio,
                oldRole: report.snapshot?.role,
            },
        });

        return {
            message: REPORT_MESSAGES.REPORT_RESOLVED_SUCCESS,
            report: finalReport,
        };
    }

    async quickPenalty(
        targetUserId: string,
        adminId: string,
        adminRole: UserRole,
        dto: QuickPenaltyDto,
        req: any,
    ) {
        return await this.reportAdminActionService.quickPenalty(
            targetUserId,
            adminId,
            adminRole,
            dto,
            req,
            this.resolve.bind(this),
        );
    }

    async manualBan(
        targetUserId: string,
        adminId: string,
        adminRole: UserRole,
        dto: ManualBanDto,
        req: any,
    ) {
        return await this.reportAdminActionService.manualBan(
            targetUserId,
            adminId,
            adminRole,
            dto,
            req,
            this.resolve.bind(this),
        );
    }

    async unban(
        targetUserId: string,
        adminId: string,
        adminRole: UserRole,
        dto: AdminActionWithPasswordDto,
        req: any,
    ) {
        return await this.reportAdminActionService.unban(
            targetUserId,
            adminId,
            adminRole,
            dto,
            req,
        );
    }

    async unmute(
        targetUserId: string,
        adminId: string,
        adminRole: UserRole,
        dto: AdminActionWithPasswordDto,
        req: any,
    ) {
        return await this.reportAdminActionService.unmute(
            targetUserId,
            adminId,
            adminRole,
            dto,
            req,
        );
    }

    async clearStrike(
        targetUserId: string,
        adminId: string,
        adminRole: UserRole,
        dto: AdminActionWithPasswordDto,
        req: any,
    ) {
        return await this.reportAdminActionService.clearStrike(
            targetUserId,
            adminId,
            adminRole,
            dto,
            req,
        );
    }

    async deleteMediasAndReportDismissed() {
        return await this.reportCleanupService.deleteMediasAndReportDismissed();
    }

    async isMediaInReport(mediaId: string) {
        return await this.reportCleanupService.isMediaInReport(mediaId);
    }
}
