/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import {
    BadRequestException,
    ForbiddenException,
    Inject,
    Injectable,
    forwardRef,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { AdminActionWithPasswordDto } from '@/modules/users/dto/update-user.dto';
import { toObjectId } from '@/utils/utils';
import {
    AuditLogActionEnum,
    AuditLogTargetEnum,
} from '../audit-log/types/audit-log.type';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/types/user';
import { REPORT_MESSAGES } from './constants/report.constant';
import { ManualBanDto } from './dto/manual-ban.dto';
import { QuickPenaltyDto } from './dto/quick-penalty.dto';
import { Report, ReportDocument } from './schemas/report.schema';
import {
    PenaltyActionEnum,
    ReportReasonEnum,
    ReportStatusEnum,
} from './types/report.type';
import type { ResolveReportFunc } from './types/report.type';

@Injectable()
export class ReportAdminActionService {
    constructor(
        @InjectModel(Report.name)
        private readonly reportModel: Model<ReportDocument>,
        @Inject(forwardRef(() => UsersService))
        private readonly usersService: UsersService,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    async verifyAdminPassword(
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

    /**
     * Tạo report ngầm từ thao tác phạt nhanh của admin rồi chuyển qua flow resolve.
     */
    async quickPenalty(
        targetUserId: string,
        adminId: string,
        adminRole: UserRole,
        dto: QuickPenaltyDto,
        req: any,
        resolveReport: ResolveReportFunc,
    ) {
        await this.verifyAdminPassword(adminId, adminRole, dto.password);
        const objectAdminId = toObjectId(adminId, 'adminId');
        const objectTargetUserId = toObjectId(targetUserId, 'targetUserId');

        const targetUser = await this.usersService.findOne(targetUserId);
        if (!targetUser) {
            throw new BadRequestException(
                REPORT_MESSAGES.TARGET_USER_NOT_FOUND,
            );
        }

        const report = new this.reportModel({
            reporterId: objectAdminId,
            targetUserId: objectTargetUserId,
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
            return await resolveReport(
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

    /**
     * Tạo report ngầm cho lệnh ban thủ công rồi resolve với penalty ban override.
     */
    async manualBan(
        targetUserId: string,
        adminId: string,
        adminRole: UserRole,
        dto: ManualBanDto,
        req: any,
        resolveReport: ResolveReportFunc,
    ) {
        await this.verifyAdminPassword(adminId, adminRole, dto.password);
        const objectAdminId = toObjectId(adminId, 'adminId');
        const objectTargetUserId = toObjectId(targetUserId, 'targetUserId');

        const targetUser = await this.usersService.findOne(targetUserId);
        if (!targetUser) {
            throw new BadRequestException(
                REPORT_MESSAGES.TARGET_USER_NOT_FOUND,
            );
        }

        const report = new this.reportModel({
            reporterId: objectAdminId,
            targetUserId: objectTargetUserId,
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
            return await resolveReport(
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
        const objectTargetUserId = toObjectId(targetUserId, 'targetUserId');

        const targetUser = await this.usersService.findOne(targetUserId);
        if (!targetUser)
            throw new BadRequestException(REPORT_MESSAGES.USER_NOT_FOUND);

        targetUser.banUntil = undefined;
        await targetUser.save();

        const lastReport = await this.reportModel
            .findOne({
                targetUserId: objectTargetUserId,
                status: ReportStatusEnum.RESOLVED,
            })
            .sort({ resolvedAt: -1 });
        if (lastReport) {
            lastReport.status = ReportStatusEnum.DISMISSED;
            lastReport.adminNote =
                (lastReport.adminNote ? lastReport.adminNote + ' | ' : '') +
                REPORT_MESSAGES.ADMIN_UNBAN_NOTE(dto.reason);
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
        const objectTargetUserId = toObjectId(targetUserId, 'targetUserId');

        const targetUser = await this.usersService.findOne(targetUserId);
        if (!targetUser)
            throw new BadRequestException(REPORT_MESSAGES.USER_NOT_FOUND);

        targetUser.muteUntil = undefined;
        await targetUser.save();

        const lastReport = await this.reportModel
            .findOne({
                targetUserId: objectTargetUserId,
                status: ReportStatusEnum.RESOLVED,
            })
            .sort({ resolvedAt: -1 });
        if (lastReport) {
            lastReport.status = ReportStatusEnum.DISMISSED;
            lastReport.adminNote =
                (lastReport.adminNote ? lastReport.adminNote + ' | ' : '') +
                REPORT_MESSAGES.ADMIN_UNMUTE_NOTE(dto.reason);
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
            action: AuditLogActionEnum.UNMUTE_USER,
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
        const objectTargetUserId = toObjectId(targetUserId, 'targetUserId');

        const targetUser = await this.usersService.findOne(targetUserId);
        if (!targetUser)
            throw new BadRequestException(REPORT_MESSAGES.USER_NOT_FOUND);

        const lastReport = await this.reportModel
            .findOne({
                targetUserId: objectTargetUserId,
                status: ReportStatusEnum.RESOLVED,
            })
            .sort({ resolvedAt: -1 });
        if (lastReport) {
            lastReport.status = ReportStatusEnum.DISMISSED;
            lastReport.adminNote =
                (lastReport.adminNote ? lastReport.adminNote + ' | ' : '') +
                REPORT_MESSAGES.ADMIN_CLEAR_STRIKE_NOTE(dto.reason);
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
}
