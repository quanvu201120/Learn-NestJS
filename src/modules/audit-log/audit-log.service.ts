/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';
import { GetAuditLogsDto } from './dto/get-audit-logs.dto';
import { OnEvent } from '@nestjs/event-emitter';
import type {
    AuditLogEvent,
    AuditLogResponseWithPagination,
} from './types/audit-log.type';
import { GLOBAL_CONSTANTS } from '@/common/constants/global.constant';
import { serializeUser } from '@/modules/users/utils/user.serializer';
import { AuditLogResponse } from './types/audit-log.type';
@Injectable()
export class AuditLogService {
    private readonly logger = new Logger(AuditLogService.name);

    constructor(
        @InjectModel(AuditLog.name)
        private auditLogModel: Model<AuditLogDocument>,
    ) {}

    /**
     * Helper nội bộ: Format dữ liệu audit log trước khi trả về client.
     */
    private serializeAuditLog(log: any): AuditLogResponse {
        const { actorId, targetId, targetType, ...rest } = log;

        return {
            ...rest,
            _id: rest._id ? rest._id.toString() : undefined,
            actor: actorId
                ? typeof actorId === 'object' && '_id' in actorId
                    ? serializeUser(actorId, false)
                    : actorId
                : undefined,
            target:
                targetType === 'User' && targetId
                    ? typeof targetId === 'object' && '_id' in targetId
                        ? serializeUser(targetId, false)
                        : targetId
                    : targetId,
            targetType,
        };
    }

    async create(auditLog: any) {
        return await this.auditLogModel.create(auditLog);
    }

    @OnEvent('audit.log.create', { async: true })
    async handleAuditLogEvent(payload: AuditLogEvent) {
        try {
            const { req, ...logData } = payload;

            const ip =
                (req?.headers?.['x-forwarded-for'] as string)?.split(',')[0] ||
                req?.ip ||
                req?.socket?.remoteAddress ||
                'Unknown';

            const userAgent = req?.headers?.['user-agent'] || 'Unknown';

            const log: AuditLog = {
                actorId: new Types.ObjectId(logData.actorId),
                actorRole: logData.actorRole,
                action: logData.action,
                targetId: new Types.ObjectId(logData.targetId),
                targetType: logData.targetType,
                metadata: logData.metadata,
                ip,
                userAgent,
            };
            await this.auditLogModel.create(log);
        } catch (error) {
            this.logger.error('Lỗi khi ghi Audit Log:', error);
        }
    }

    async findAll(
        query: GetAuditLogsDto,
    ): Promise<AuditLogResponseWithPagination> {
        const {
            cursor,
            actorId,
            targetId,
            action,
            targetType,
            actorRole,
            ip,
            startDate,
            endDate,
        } = query;

        const limit = GLOBAL_CONSTANTS.LIMIT_AUDIT_LOGS_DEFAULT;
        const filter: any = {};

        // 1. Exact match filters
        if (actorId) {
            filter.actorId = new Types.ObjectId(actorId);
        }

        if (targetId) {
            filter.targetId = new Types.ObjectId(targetId);
        }

        if (action) {
            filter.action = action;
        }

        if (targetType) {
            filter.targetType = targetType;
        }

        if (actorRole) {
            filter.actorRole = actorRole;
        }

        if (ip) {
            filter.ip = { $regex: new RegExp(ip, 'i') };
        }

        // 2. Date range filter
        if (startDate || endDate) {
            filter.createdAt = {};
            if (startDate) {
                filter.createdAt.$gte = startDate;
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setUTCHours(23, 59, 59, 999);
                filter.createdAt.$lte = end;
            }
        }

        // 3. Cursor pagination filter
        if (cursor) {
            filter._id = { $lt: new Types.ObjectId(cursor) };
        }

        // Execute query
        const logs = await this.auditLogModel
            .find(filter)
            .sort({ _id: -1 })
            .limit(limit)
            .select('-__v')
            .populate({
                path: 'actorId',
                select: '-password -__v',
                populate: { path: 'avatar', select: '-__v' },
            })
            .populate({
                path: 'targetId',
                select: '-password -__v',
                populate: { path: 'avatar', select: '-__v' },
            })
            .lean();

        // Determine next cursor
        let nextCursor: string | null = null;
        if (logs.length === limit) {
            nextCursor = logs[logs.length - 1]._id.toString();
        }

        return {
            items: logs.map((log) => this.serializeAuditLog(log)),
            nextCursor,
        };
    }
}
