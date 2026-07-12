/* eslint-disable prettier/prettier */
/* eslint-disable prefer-const */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
    BadRequestException,
    ForbiddenException,
    Inject,
    Injectable,
    Logger,
    forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { Report, ReportDocument } from './schemas/report.schema';
import { CreateReportDto } from './dto/create-report.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { GetReportsDto } from './dto/get-reports.dto';
import { ManualBanDto } from './dto/manual-ban.dto';
import { QuickPenaltyDto } from './dto/quick-penalty.dto';
import {
    CleanupJobEntityEnum,
    CleanupJobResourceEnum,
} from '../cleanup-jobs/types/cleanup-job';
import { AdminActionWithPasswordDto } from '@/modules/users/dto/update-user.dto';
import { UsersService } from '../users/users.service';
import { SessionService } from '../session/session.service';
import {
    PenaltyActionEnum,
    ReportReasonEnum,
    ReportStatusEnum,
} from './types/report.type';
import { PENALTY_RULES } from './constants/penalty.constant';
import { formatDateTime, validateObjectId } from '@/utils/utils';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
    AuditLogActionEnum,
    AuditLogTargetEnum,
} from '../audit-log/types/audit-log.type';
import bcrypt from 'bcrypt';
import { UserRole } from '../users/types/user';
import { CleanupJobsService } from '../cleanup-jobs/cleanup-jobs.service';
import { MediaService } from '../media/media.service';
import { REPORT_CONSTANTS, REPORT_MESSAGES } from './constants/report.constant';
import { GLOBAL_CONSTANTS } from '@/common/constants/global.constant';
import { MEDIA_CONSTANTS } from '../media/constants/media.constant';
import { OwnerTypeEnum } from '../media/types/media';
import { Media, MediaDocument } from '../media/schemas/media.schema';

@Injectable()
export class ReportsService {
    private readonly logger = new Logger(ReportsService.name);

    constructor(
        @InjectModel(Report.name) private reportModel: Model<ReportDocument>,
        @Inject(forwardRef(() => UsersService))
        private readonly usersService: UsersService,
        private readonly sessionService: SessionService,
        private readonly cleanupJobsService: CleanupJobsService,
        private readonly mediaService: MediaService,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    async create(
        createReportDto: CreateReportDto,
        reporterId: string,
        files: Express.Multer.File[] = [],
    ) {
        validateObjectId(createReportDto.targetUserId, 'targetUserId');

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
                reporterId,
                targetUserId: createReportDto.targetUserId,
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

        const uploadedMediaDocs = await this.uploadEvidenceImages(
            reporterId,
            files,
        );

        try {
            const report = new this.reportModel({
                ...createReportDto,
                evidenceMediaIds: uploadedMediaDocs.map((media) => media._id),
                reporterId,
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
            await Promise.allSettled(
                uploadedMediaDocs.map((media) =>
                    this.mediaService.deleteMedia(media._id.toString()),
                ),
            );
            if (uploadedMediaDocs.length > 0) {
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
            throw error;
        }
    }

    private async uploadEvidenceImages(
        reporterId: string,
        files: Express.Multer.File[],
    ) {
        if (!files.length) {
            return [];
        }

        const uploadedMedias: MediaDocument[] = [];
        const objectReporterId = new Types.ObjectId(reporterId);

        try {
            for (const file of files) {
                const uploadedMedia =
                    await this.mediaService.uploadImageToCloudinary(
                        objectReporterId,
                        OwnerTypeEnum.USER,
                        objectReporterId,
                        file,
                        MEDIA_CONSTANTS.REPORT_EVIDENCE_FOLDER,
                    );

                const createdMedia =
                    await this.mediaService.createMedia(uploadedMedia);
                uploadedMedias.push(createdMedia);
            }

            return uploadedMedias;
        } catch (error) {
            await Promise.allSettled(
                uploadedMedias.map((media) =>
                    this.mediaService.deleteMedia(media._id.toString()),
                ),
            );
            const publicIds = uploadedMedias
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
            throw error;
        }
    }

    async findAll(query: GetReportsDto) {
        const {
            current = 1,
            pageSize = GLOBAL_CONSTANTS.LIMIT_REPORTS_DEFAULT,
            startDate,
            endDate,
            reportId,
            sort,
            ...filters
        } = query;
        const page = Math.max(Number(current) || 1, 1);
        const limit = Math.min(
            Math.max(
                Number(pageSize) || GLOBAL_CONSTANTS.LIMIT_REPORTS_DEFAULT,
                1,
            ),
            GLOBAL_CONSTANTS.LIMIT_REPORTS_MAX,
        );
        const skip = (page - 1) * limit;

        const filterQuery: any = { ...filters };

        if (filterQuery.targetRole) {
            filterQuery['snapshot.role'] = filterQuery.targetRole;
            delete filterQuery.targetRole;
        }

        if (startDate || endDate) {
            filterQuery.createdAt = {};
            if (startDate) filterQuery.createdAt.$gte = new Date(startDate);
            if (endDate) filterQuery.createdAt.$lte = new Date(endDate);
        }

        if (reportId) {
            filterQuery._id = reportId;
        }

        const sortQuery: any = {};
        if (sort === 'oldest') {
            sortQuery.createdAt = 1;
        } else {
            sortQuery.createdAt = -1; // newest by default
        }

        const totalItems = await this.reportModel.countDocuments(filterQuery);
        const totalPages = Math.ceil(totalItems / limit);

        const reports = await this.reportModel
            .find(filterQuery)
            .sort(sortQuery)
            .skip(skip)
            .limit(limit)
            .populate({
                path: 'reporterId',
                select: 'name email avatar bio role',
                populate: { path: 'avatar', select: '-__v' },
            })
            .populate({
                path: 'targetUserId',
                select: 'name email avatar bio role',
                populate: { path: 'avatar', select: '-__v' },
            })
            .populate('resolvedBy', 'name email')
            .populate('evidenceMediaIds', '-__v')
            .populate('appealEvidenceMediaIds', '-__v')
            .populate('snapshot.avatarMediaId', '-__v')
            .lean();

        return { totalPages, totalItems, reports };
    }

    async findByIdForApi(id: string) {
        return await this.reportModel.findById(id);
    }

    async findOne(id: string) {
        validateObjectId(id, 'reportId');
        const report = await this.reportModel
            .findById(id)
            .populate({
                path: 'reporterId',
                select: 'name email avatar bio role',
                populate: { path: 'avatar', select: '-__v' },
            })
            .populate({
                path: 'targetUserId',
                select: 'name email avatar bio role',
                populate: { path: 'avatar', select: '-__v' },
            })
            .populate('resolvedBy', 'name email')
            .populate('evidenceMediaIds', '-__v')
            .populate('appealEvidenceMediaIds', '-__v')
            .populate('snapshot.avatarMediaId', '-__v')
            .lean();

        if (!report) {
            throw new BadRequestException(REPORT_MESSAGES.REPORT_NOT_FOUND);
        }
        return report;
    }

    private async verifyAdminPassword(
        adminId: string,
        adminRole: UserRole,
        passwordRaw: string,
    ) {
        const adminUser = await this.usersService.findOne(adminId);
        if (!adminUser) {
            throw new BadRequestException(REPORT_MESSAGES.ADMIN_NOT_FOUND);
        }
        if (adminUser.role !== adminRole) {
            throw new ForbiddenException(REPORT_MESSAGES.MISSING_PERMISSION);
        }
        const isPasswordValid = await bcrypt.compare(
            passwordRaw,
            adminUser.password,
        );
        if (!isPasswordValid) {
            throw new BadRequestException(REPORT_MESSAGES.INVALID_PASSWORD);
        }
        return adminUser;
    }

    private getPenaltyFamily(action: PenaltyActionEnum) {
        if (
            action === PenaltyActionEnum.WARNING ||
            action === PenaltyActionEnum.RESET_AND_WARNING
        ) {
            return 'warning';
        }

        if (action === PenaltyActionEnum.MUTE) {
            return 'mute';
        }

        if (
            action === PenaltyActionEnum.BAN ||
            action === PenaltyActionEnum.RESET_AND_BAN
        ) {
            return 'ban';
        }

        return 'other';
    }

    private getCurrentActivePenalties(targetUser: any) {
        const now = new Date();
        const penalties: Partial<Record<'ban' | 'mute', Date>> = {};

        const banUntil = targetUser?.banUntil ? new Date(targetUser.banUntil) : null;
        if (banUntil && banUntil > now) {
            penalties.ban = banUntil;
        }

        const muteUntil = targetUser?.muteUntil ? new Date(targetUser.muteUntil) : null;
        if (muteUntil && muteUntil > now) {
            penalties.mute = muteUntil;
        }

        return penalties;
    }

    private ensurePenaltyIsNotReduced(
        targetUser: any,
        actionToApply: PenaltyActionEnum,
        durationDays: number,
    ) {
        const currentPenalties = this.getCurrentActivePenalties(targetUser);
        const proposedFamily = this.getPenaltyFamily(actionToApply);

        if (proposedFamily === 'mute') {
            const currentMuteUntil = currentPenalties.mute;
            if (!currentMuteUntil) {
                return;
            }

            const proposedUntil = new Date(
                Date.now() + durationDays * 24 * 60 * 60 * 1000,
            );
            if (proposedUntil < currentMuteUntil) {
                throw new BadRequestException(
                    REPORT_MESSAGES.CANNOT_REDUCE_PENALTY,
                );
            }
            return;
        }

        if (proposedFamily === 'ban') {
            const currentBanUntil = currentPenalties.ban;
            if (!currentBanUntil) {
                return;
            }

            const proposedUntil = new Date(
                Date.now() + durationDays * 24 * 60 * 60 * 1000,
            );
            if (proposedUntil < currentBanUntil) {
                throw new BadRequestException(
                    REPORT_MESSAGES.CANNOT_REDUCE_PENALTY,
                );
            }
            return;
        }
    }

    private async calculateAndApplyPenalty(
        targetUserId: string,
        reason: ReportReasonEnum,
        adminId: string,
        adminRole: UserRole,
        overrideAction?: PenaltyActionEnum,
        overrideDurationDays?: number,
        resetAvatar?: boolean,
        resetBio?: boolean,
        resetName?: boolean,
        session?: ClientSession,
    ): Promise<{ penaltyAppliedStr: string; banUntil?: Date; muteUntil?: Date }> {
        const targetUser = await this.usersService.findOne(targetUserId);
        if (!targetUser) {
            throw new BadRequestException(
                REPORT_MESSAGES.TARGET_USER_NOT_FOUND,
            );
        }

        if (targetUser.role === UserRole.SUPER_ADMIN) {
            throw new ForbiddenException(
                REPORT_MESSAGES.CANNOT_PENALIZE_SUPER_ADMIN,
            );
        }

        // Prevent applying penalty to admin by lower role
        if (
            adminRole === UserRole.ADMIN &&
            targetUser.role === UserRole.ADMIN
        ) {
            throw new ForbiddenException(REPORT_MESSAGES.CANNOT_PENALIZE_USER);
        }

        if (adminId === targetUserId) {
            throw new BadRequestException(REPORT_MESSAGES.CANNOT_PENALIZE_SELF);
        }

        // Count previous resolved reports for this reason
        const strikeCount = await this.reportModel.countDocuments({
            targetUserId,
            reason,
            status: ReportStatusEnum.RESOLVED,
        });

        // Current strike is existing + 1 (for the current report)
        const currentStrike = strikeCount + 1;

        let actionToApply: PenaltyActionEnum | null = null;
        let duration = 0;

        if (overrideAction) {
            actionToApply = overrideAction;
            duration = overrideDurationDays || 0;
        } else {
            const rules = PENALTY_RULES[reason];
            if (rules && rules.length > 0) {
                // Find the rule for current strike, or use the maximum rule if strike exceeds defined rules
                let rule = rules.find((r: any) => r.strike === currentStrike);
                if (!rule) {
                    rule = rules[rules.length - 1]; // Use the most severe rule if they exceed max
                }
                actionToApply = rule.action;
                duration = rule.durationDays;
            }
        }

        if (!actionToApply) {
            return { penaltyAppliedStr: REPORT_MESSAGES.NO_AUTO_PENALTY };
        }

        this.ensurePenaltyIsNotReduced(targetUser, actionToApply, duration);

        const now = new Date();
        let penaltyAppliedStr = '';
        let muteUntil: Date | undefined;

        if (actionToApply === PenaltyActionEnum.WARNING) {
            penaltyAppliedStr = REPORT_MESSAGES.WARNING_SENT;
        } else if (actionToApply === PenaltyActionEnum.MUTE) {
            muteUntil = new Date(
                now.getTime() + duration * 24 * 60 * 60 * 1000,
            );
            targetUser.muteUntil = muteUntil;
            penaltyAppliedStr = REPORT_MESSAGES.MUTE_APPLIED(
                duration,
                formatDateTime(muteUntil),
            );
        } else if (actionToApply === PenaltyActionEnum.RESET_AND_WARNING) {
            let hasSpecificReset = false;
            if (resetAvatar) {
                targetUser.avatar = undefined;
                hasSpecificReset = true;
            }
            if (resetBio) {
                targetUser.bio = undefined;
                hasSpecificReset = true;
            }
            if (resetName) {
                targetUser.name = `User_${Math.floor(100000 + Math.random() * 900000)}`;
                hasSpecificReset = true;
            }
            if (!hasSpecificReset) {
                targetUser.avatar = undefined;
                targetUser.bio = undefined;
            }
            penaltyAppliedStr = REPORT_MESSAGES.RESET_AND_WARNING;
        } else if (actionToApply === PenaltyActionEnum.RESET_AND_BAN) {
            let hasSpecificReset = false;
            if (resetAvatar) {
                targetUser.avatar = undefined;
                hasSpecificReset = true;
            }
            if (resetBio) {
                targetUser.bio = undefined;
                hasSpecificReset = true;
            }
            if (resetName) {
                targetUser.name = `User_${Math.floor(100000 + Math.random() * 900000)}`;
                hasSpecificReset = true;
            }
            if (!hasSpecificReset) {
                targetUser.avatar = undefined;
                targetUser.bio = undefined;
            }
            const until = new Date(
                now.getTime() + duration * 24 * 60 * 60 * 1000,
            );
            targetUser.banUntil = until;
            targetUser.tokenVersion += 1;
            penaltyAppliedStr = REPORT_MESSAGES.RESET_AND_BAN(
                duration,
                formatDateTime(until),
            );
        } else if (actionToApply === PenaltyActionEnum.BAN) {
            let hasSpecificReset = false;
            if (resetAvatar) {
                targetUser.avatar = undefined;
                hasSpecificReset = true;
            }
            if (resetBio) {
                targetUser.bio = undefined;
                hasSpecificReset = true;
            }
            if (resetName) {
                targetUser.name = `User_${Math.floor(100000 + Math.random() * 900000)}`;
                hasSpecificReset = true;
            }

            const until = new Date(
                now.getTime() + duration * 24 * 60 * 60 * 1000,
            );
            targetUser.banUntil = until;
            targetUser.tokenVersion += 1;
            penaltyAppliedStr = hasSpecificReset
                ? REPORT_MESSAGES.RESET_AND_BAN(duration, formatDateTime(until))
                : REPORT_MESSAGES.BAN_APPLIED(duration, formatDateTime(until));
        }

        await targetUser.save({ session });

        return {
            penaltyAppliedStr,
            banUntil: targetUser.banUntil,
            muteUntil,
        };
    }

    async calculatePenaltyInfo(targetUserId: string, reason: ReportReasonEnum) {
        // Count previous resolved reports for this reason
        const strikeCount = await this.reportModel.countDocuments({
            targetUserId,
            reason,
            status: ReportStatusEnum.RESOLVED,
        });

        const currentStrike = strikeCount + 1;

        let actionToApply: PenaltyActionEnum | null = null;
        let duration = 0;

        const rules = PENALTY_RULES[reason];
        if (rules && rules.length > 0) {
            let rule = rules.find((r: any) => r.strike === currentStrike);
            if (!rule) {
                rule = rules[rules.length - 1];
            }
            actionToApply = rule.action;
            duration = rule.durationDays;
        }

        return {
            action: actionToApply,
            durationDays: duration,
            strike: currentStrike,
        };
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
                ? 'Bỏ qua báo cáo SUPER_ADMIN'
                : adminNote;

        const originalStatus = report.status;
        const claimedReport = await this.reportModel.findOneAndUpdate(
            { _id: report._id, status: report.status },
            {
                $set: {
                    status: ReportStatusEnum.RESOLVING,
                },
            },
            { new: true },
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
                    { new: true, session },
                );

                if (!claimedInTx) {
                    throw new BadRequestException(
                        REPORT_MESSAGES.REPORT_ALREADY_RESOLVED,
                    );
                }

                finalReport = claimedInTx;

                if (resolveDto.status === ReportStatusEnum.RESOLVED) {
                    const penaltyResult = await this.calculateAndApplyPenalty(
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
        await this.verifyAdminPassword(adminId, adminRole, dto.password);

        const targetUser = await this.usersService.findOne(targetUserId);
        if (!targetUser) {
            throw new BadRequestException(
                REPORT_MESSAGES.TARGET_USER_NOT_FOUND,
            );
        }

        // Tạo ngầm 1 report
        const report = new this.reportModel({
            reporterId: adminId,
            targetUserId,
            reason: dto.reason as ReportReasonEnum,
            snapshot: {
                avatarMediaId: targetUser.avatar,
                displayName: targetUser.name,
                bio: targetUser.bio,
                role: targetUser.role,
            },
            status: ReportStatusEnum.PENDING,
            description: dto.adminNote || REPORT_MESSAGES.QUICK_PENALTY_DESC,
        });
        await report.save();

        try {
            // Tự động resolve
            return await this.resolve(
                report._id.toString(),
                {
                    status: ReportStatusEnum.RESOLVED,
                    adminNote: dto.reason || REPORT_MESSAGES.QUICK_PENALTY_NOTE,
                    resetAvatar: dto.resetAvatar,
                    resetBio: dto.resetBio,
                    resetName: dto.resetName,
                },
                adminId,
                adminRole,
                req,
            );
        } catch (error) {
            const latest = await this.reportModel
                .findById(report._id)
                .select('status');
            if (
                [ReportStatusEnum.PENDING, ReportStatusEnum.RESOLVING].includes(
                    latest?.status as ReportStatusEnum,
                )
            ) {
                await this.reportModel.deleteOne({ _id: report._id });
            }
            throw error;
        }
    }

    async manualBan(
        targetUserId: string,
        adminId: string,
        adminRole: UserRole,
        dto: ManualBanDto,
        req: any,
    ) {
        await this.verifyAdminPassword(adminId, adminRole, dto.password);

        const targetUser = await this.usersService.findOne(targetUserId);
        if (!targetUser) {
            throw new BadRequestException(
                REPORT_MESSAGES.TARGET_USER_NOT_FOUND,
            );
        }

        // Tạo ngầm 1 report
        const report = new this.reportModel({
            reporterId: adminId,
            targetUserId,
            reason: ReportReasonEnum.OTHER,
            snapshot: {
                avatarMediaId: targetUser.avatar,
                displayName: targetUser.name,
                bio: targetUser.bio,
                role: targetUser.role,
            },
            status: ReportStatusEnum.PENDING,
            description: dto.reason || REPORT_MESSAGES.MANUAL_BAN_DESC,
        });
        await report.save();

        try {
            // Tự động resolve luôn và ghi vào penalty
            return await this.resolve(
                report._id.toString(),
                {
                    status: ReportStatusEnum.RESOLVED,
                    adminNote: dto.reason,
                    overridePenaltyAction: PenaltyActionEnum.BAN,
                    overridePenaltyDurationDays: dto.durationDays,
                    resetAvatar: dto.resetAvatar,
                    resetBio: dto.resetBio,
                    resetName: dto.resetName,
                },
                adminId,
                adminRole,
                req,
            );
        } catch (error) {
            const latest = await this.reportModel
                .findById(report._id)
                .select('status');
            if (
                [ReportStatusEnum.PENDING, ReportStatusEnum.RESOLVING].includes(
                    latest?.status as ReportStatusEnum,
                )
            ) {
                await this.reportModel.deleteOne({ _id: report._id });
            }
            throw error;
        }
    }

    async unban(
        targetUserId: string,
        adminId: string,
        adminRole: UserRole,
        dto: AdminActionWithPasswordDto,
        req: any,
    ) {
        await this.verifyAdminPassword(adminId, adminRole, dto.password);
        validateObjectId(targetUserId, 'targetUserId');

        const targetUser = await this.usersService.findOne(targetUserId);
        if (!targetUser)
            throw new BadRequestException(REPORT_MESSAGES.USER_NOT_FOUND);

        targetUser.banUntil = undefined;
        await targetUser.save();

        // Tìm report resolved gần nhất và đổi thành dismissed để kháng cáo (trừ án tích)
        const lastReport = await this.reportModel
            .findOne({ targetUserId, status: ReportStatusEnum.RESOLVED })
            .sort({ resolvedAt: -1 });
        if (lastReport) {
            lastReport.status = ReportStatusEnum.DISMISSED;
            lastReport.adminNote =
                (lastReport.adminNote ? lastReport.adminNote + ' | ' : '') +
                REPORT_MESSAGES.APPEAL_SUCCESS(dto.reason);
            lastReport.appealDeadline = undefined;
            await lastReport.save();
        }

        this.eventEmitter.emit('audit.log.create', {
            req,
            actorId: adminId,
            actorRole: adminRole,
            action: AuditLogActionEnum.UNLOCK_USER,
            targetId: targetUserId,
            targetType: AuditLogTargetEnum.USER,
            metadata: { reason: dto.reason },
        });

        const { password, tokenVersion, ...userObj } = targetUser.toObject();

        return { message: REPORT_MESSAGES.UNBAN_SUCCESS, user: userObj };
    }

    async unmute(
        targetUserId: string,
        adminId: string,
        adminRole: UserRole,
        dto: AdminActionWithPasswordDto,
        req: any,
    ) {
        await this.verifyAdminPassword(adminId, adminRole, dto.password);
        validateObjectId(targetUserId, 'targetUserId');

        const targetUser = await this.usersService.findOne(targetUserId);
        if (!targetUser)
            throw new BadRequestException(REPORT_MESSAGES.USER_NOT_FOUND);

        targetUser.muteUntil = undefined;
        await targetUser.save();

        // Tìm report resolved gần nhất và đổi thành dismissed để kháng cáo (trừ án tích)
        const lastReport = await this.reportModel
            .findOne({ targetUserId, status: ReportStatusEnum.RESOLVED })
            .sort({ resolvedAt: -1 });
        if (lastReport) {
            lastReport.status = ReportStatusEnum.DISMISSED;
            lastReport.adminNote =
                (lastReport.adminNote ? lastReport.adminNote + ' | ' : '') +
                REPORT_MESSAGES.APPEAL_SUCCESS(dto.reason);
            lastReport.appealDeadline = undefined;
            await lastReport.save();
        }

        this.eventEmitter.emit('user.unmuted', {
            userId: targetUserId,
        });

        this.eventEmitter.emit('audit.log.create', {
            req,
            actorId: adminId,
            actorRole: adminRole,
            action: AuditLogActionEnum.UNMUTE_USER, // Hoặc một enum chuyên cho UNMUTE
            targetId: targetUserId,
            targetType: AuditLogTargetEnum.USER,
            metadata: { reason: dto.reason, action: 'unmute' },
        });

        const { password, tokenVersion, ...userObj } = targetUser.toObject();
        return { message: REPORT_MESSAGES.UNMUTE_SUCCESS, user: userObj };
    }

    async clearStrike(
        targetUserId: string,
        adminId: string,
        adminRole: UserRole,
        dto: AdminActionWithPasswordDto,
        req: any,
    ) {
        await this.verifyAdminPassword(adminId, adminRole, dto.password);
        validateObjectId(targetUserId, 'targetUserId');

        const targetUser = await this.usersService.findOne(targetUserId);
        if (!targetUser)
            throw new BadRequestException(REPORT_MESSAGES.USER_NOT_FOUND);

        const lastReport = await this.reportModel
            .findOne({ targetUserId, status: ReportStatusEnum.RESOLVED })
            .sort({ resolvedAt: -1 });
        if (lastReport) {
            lastReport.status = ReportStatusEnum.DISMISSED;
            lastReport.adminNote =
                (lastReport.adminNote ? lastReport.adminNote + ' | ' : '') +
                REPORT_MESSAGES.APPEAL_SUCCESS(dto.reason);
            lastReport.appealDeadline = undefined;
            await lastReport.save();
        }

        this.eventEmitter.emit('audit.log.create', {
            req,
            actorId: adminId,
            actorRole: adminRole,
            action: AuditLogActionEnum.APPEAL_REPORT,
            targetId: targetUserId,
            targetType: AuditLogTargetEnum.USER,
            metadata: { reason: dto.reason, action: 'clear_strike' },
        });

        const { password, tokenVersion, ...userObj } = targetUser.toObject();
        return {
            message: REPORT_MESSAGES.STRIKE_CLEARED_SUCCESS,
            user: userObj,
        };
    }

    async deleteMediasAndReportDismissed() {
        const now = new Date();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        //Lấy danh sách report nằm trong diện dọn dẹp:
        // report super_admin sẽ bị tự động được dọn dẹp (không quan tâm thời gian, status)
        // đã từ chối (DISMISSED) -> xóa report và media,
        // đã xử lý và hết hạn kháng cáo (RESOLVED) -> xóa media, giữ report làm án tích,
        // kháng cáo thành công(APPEAL_SUCCESS) -> xóa report và media,
        // kháng cáo thất bại (APPEAL_REJECTED) -> xóa media, giữ report làm án tích
        //Đối với DISMISSED, APPEAL_SUCCESS, APPEAL_REJECTED: Phải thỏa mãn updatedAt < 30 ngày (tức là hệ thống cố tình lưu lại ít nhất 30 ngày trước khi dọn dẹp vĩnh viễn).
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

        // 1. Kiểm tra avatar song song nhưng gom nhóm để tránh vòng lặp (Deadlock)

        //key là avatarId, value là {avatar, targetUserId}
        const uniqueAvatars = new Map<string, any>();
        const oldReportIds = oldReports.map((r) => r._id);

        //1.1 lọc ra mảng avatar không trùng lặp
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

        //1.2 kiểm tra xem avatar có vô chủ
        // hay đang được sử dụng  bởi report khác không nằm trong danh sách dọn dẹp
        const deletableAvatarIds = new Set<string>(); //value là avatarIdStr
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
                        // Chỉ kiểm tra các report ĐANG ACTIVE (không nằm trong danh sách chuẩn bị xoá)
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

        //1.3 sau khi đã xã định được avatar có thể xóa
        // ta sẽ đánh dấu report nào đang có snapshot liên quan đến avt đó
        //value mảng là object {report: ReportDocument, shouldDeleteAvatar: boolean}
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

        //value sẽ là mediaDocument do đã populate
        let validMedias: any[] = [];
        //chứa các câu lệnh truy vấn update/delete report
        const bulkOps: any[] = [];

        // 2. Gom danh sách Media và Report cần xóa, update unset nếu chỉ dọn dẹp media
        // report đã nằm trong danh sách thì tất cả media đều bị dọn dẹp
        // bao gồm avt vô chủ, bằng chứng report và bằng chứng kháng cáo
        // trừ những media avt nào còn được sử dụng
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

        //Nếu có 2 report khác nhau (cùng nằm trong diện dọn dẹp) đều snapshot lại CÙNG 1 avatar , thì cái avatar đó sẽ bị push() vào mảng validMedias 2 lần.
        const uniqueValidMediasMap = new Map();
        for (const media of validMedias) {
            uniqueValidMediasMap.set(media._id.toString(), media);
        }
        validMedias = Array.from(uniqueValidMediasMap.values());

        // 3. Thực thi cập nhật/xóa Report VÀ xóa DB của Media trong Transaction (ATOMIC)
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

        // 4. CHỈ KHI DATABASE THÀNH CÔNG, mới gọi lên Cloudinary để xóa file cứng
        if (validMedias.length > 0) {
            //map từ array media đã populated -> array chứa publicId
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
