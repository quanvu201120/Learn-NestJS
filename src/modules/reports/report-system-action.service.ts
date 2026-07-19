import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RedisService } from '@/redis/redis.service';
import { toObjectId } from '@/utils/utils';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/types/user';
import { Report, ReportDocument } from './schemas/report.schema';
import {
    PenaltyActionEnum,
    ReportReasonEnum,
    ReportStatusEnum,
} from './types/report.type';
import type { CreateAndResolveReportFunc } from './types/report.type';
import {
    RATE_LIMIT_BAN_DAYS,
    RATE_LIMIT_BAN_LOCK_TTL_SECONDS,
    RATE_LIMIT_BAN_THRESHOLD,
    RATE_LIMIT_VIOLATION_TTL_SECONDS,
} from './constants/penalty.constant';
import { REPORT_MESSAGES } from './constants/report.constant';

@Injectable()
export class ReportSystemActionService {
    constructor(
        @InjectModel(Report.name)
        private readonly reportModel: Model<ReportDocument>,
        private readonly configService: ConfigService,
        private readonly redisService: RedisService,
        @Inject(forwardRef(() => UsersService))
        private readonly usersService: UsersService,
    ) {}

    private getRateLimitViolationCounterKey = (userId: string) => {
        return `rate-limit:violations:user:${userId}`;
    };

    private getRateLimitBanLockKey = (userId: string) => {
        return `rate-limit:ban-lock:user:${userId}`;
    };

    /**
     * Đếm số lần user đã bị throttler chặn trong Redis và
     * kích hoạt flow auto ban spam hệ thống.
     */
    async recordRateLimitViolation(
        userId: string,
        req: any,
        createAndResolveReport: CreateAndResolveReportFunc,
    ) {
        const counterKey = this.getRateLimitViolationCounterKey(userId);
        const count = await this.redisService.incrWithTTL(
            counterKey,
            RATE_LIMIT_VIOLATION_TTL_SECONDS,
        );

        if (count < RATE_LIMIT_BAN_THRESHOLD) {
            return;
        }

        const lockKey = this.getRateLimitBanLockKey(userId);
        const locked = await this.redisService.setIfNotExistsWithTTL(
            lockKey,
            '1',
            RATE_LIMIT_BAN_LOCK_TTL_SECONDS,
        );

        if (!locked) {
            return;
        }

        try {
            await this.autoBanRateLimitUser(
                userId,
                req,
                createAndResolveReport,
            );
            await this.redisService.del(counterKey);
        } catch {
            return;
        }
    }

    /**
     * Tạo report SYSTEM_SPAM rồi resolve qua pipeline report hiện có để giữ
     * đồng bộ audit log, revoke session, notification và realtime event.
     */
    private async autoBanRateLimitUser(
        targetUserId: string,
        req: any,
        createAndResolveReport: CreateAndResolveReportFunc,
    ) {
        const systemAdminId = this.configService.get<string>('SYSTEM_ADMIN_ID');
        if (!systemAdminId) {
            return;
        }

        const [{ existingUser: targetUser }, { existingUser: systemAdmin }] =
            await Promise.all([
                this.usersService.checkUser(targetUserId),
                this.usersService.checkUser(systemAdminId),
            ]);

        if (
            targetUser.role === UserRole.SUPER_ADMIN ||
            systemAdmin.role !== UserRole.SUPER_ADMIN
        ) {
            return;
        }

        const proposedBanUntil = new Date(
            Date.now() + RATE_LIMIT_BAN_DAYS * 24 * 60 * 60 * 1000,
        );
        if (targetUser.banUntil && targetUser.banUntil > proposedBanUntil) {
            return;
        }

        const report = new this.reportModel({
            reporterId: toObjectId(systemAdminId, 'systemAdminId'),
            targetUserId: toObjectId(targetUserId, 'targetUserId'),
            reason: ReportReasonEnum.SYSTEM_SPAM,
            snapshot: {
                avatarMediaId: targetUser.avatar,
                displayName: targetUser.name,
                bio: targetUser.bio,
                role: targetUser.role,
            },
            status: ReportStatusEnum.PENDING,
            description: REPORT_MESSAGES.SYSTEM_BAN_SPAM_DESCRIPTION,
        });
        await createAndResolveReport(
            report,
            {
                status: ReportStatusEnum.RESOLVED,
                adminNote: REPORT_MESSAGES.SYSTEM_BAN_SPAM_DESCRIPTION,
                overridePenaltyAction: PenaltyActionEnum.BAN,
                overridePenaltyDurationDays: RATE_LIMIT_BAN_DAYS,
            },
            systemAdminId,
            systemAdmin.role,
            req,
        );
    }
}
