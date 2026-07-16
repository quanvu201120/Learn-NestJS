/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
    BadRequestException,
    ForbiddenException,
    Inject,
    Injectable,
    forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { formatDateTime } from '@/utils/utils';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/types/user';
import { REPORT_MESSAGES } from './constants/report.constant';
import { PENALTY_RULES } from './constants/penalty.constant';
import { Report, ReportDocument } from './schemas/report.schema';
import {
    PenaltyActionEnum,
    PenaltyTypeEnum,
    ReportReasonEnum,
    ReportStatusEnum,
} from './types/report.type';

@Injectable()
export class ReportPenaltyService {
    constructor(
        @InjectModel(Report.name)
        private readonly reportModel: Model<ReportDocument>,
        @Inject(forwardRef(() => UsersService))
        private readonly usersService: UsersService,
    ) {}

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

        const banUntil = targetUser?.banUntil
            ? new Date(targetUser.banUntil)
            : null;
        if (banUntil && banUntil > now) {
            penalties.ban = banUntil;
        }

        const muteUntil = targetUser?.muteUntil
            ? new Date(targetUser.muteUntil)
            : null;
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

    /**
     * Tính hình phạt theo rule/override và áp dụng trực tiếp lên target user
     * trong cùng transaction xử lý report nếu có session.
     */
    async calculateAndApplyPenalty(
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
    ): Promise<{
        penaltyAppliedStr: string;
        penaltyType?: PenaltyTypeEnum;
        banUntil?: Date;
        muteUntil?: Date;
    }> {
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

        if (
            adminRole === UserRole.ADMIN &&
            targetUser.role === UserRole.ADMIN
        ) {
            throw new ForbiddenException(REPORT_MESSAGES.CANNOT_PENALIZE_USER);
        }

        if (adminId === targetUserId) {
            throw new BadRequestException(REPORT_MESSAGES.CANNOT_PENALIZE_SELF);
        }

        const strikeCount = await this.reportModel.countDocuments({
            targetUserId,
            reason,
            status: ReportStatusEnum.RESOLVED,
        });

        const currentStrike = strikeCount + 1;

        let actionToApply: PenaltyActionEnum | null = null;
        let duration = 0;

        if (overrideAction) {
            actionToApply = overrideAction;
            duration = overrideDurationDays || 0;
        } else {
            const rules = PENALTY_RULES[reason];
            if (rules && rules.length > 0) {
                let rule = rules.find((r: any) => r.strike === currentStrike);
                if (!rule) {
                    rule = rules[rules.length - 1];
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
        let penaltyType: PenaltyTypeEnum | undefined;
        let muteUntil: Date | undefined;

        if (actionToApply === PenaltyActionEnum.WARNING) {
            penaltyAppliedStr = REPORT_MESSAGES.WARNING_SENT;
            penaltyType = PenaltyTypeEnum.WARNING;
        } else if (actionToApply === PenaltyActionEnum.MUTE) {
            muteUntil = new Date(
                now.getTime() + duration * 24 * 60 * 60 * 1000,
            );
            targetUser.muteUntil = muteUntil;
            penaltyAppliedStr = REPORT_MESSAGES.MUTE_APPLIED(
                duration,
                formatDateTime(muteUntil),
            );
            penaltyType = PenaltyTypeEnum.MUTE;
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
            penaltyType = PenaltyTypeEnum.WARNING;
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
            penaltyType = PenaltyTypeEnum.BAN;
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
            penaltyType = PenaltyTypeEnum.BAN;
        }

        await targetUser.save({ session });

        return {
            penaltyAppliedStr,
            penaltyType,
            banUntil: targetUser.banUntil,
            muteUntil,
        };
    }

    /**
     * Tính trước hình phạt dự kiến cho report đang pending để admin xem trước.
     */
    async calculatePenaltyInfo(targetUserId: string, reason: ReportReasonEnum) {
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
}
