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
import { serializeMedia } from '@/modules/media/utils/media.serializer';

const escapeRegExp = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
    private serializeReport(report: any) {
        if (
            !report ||
            typeof report !== 'object' ||
            report instanceof Types.ObjectId ||
            !Object.keys(report).includes('_id')
        ) {
            return report ? report.toString() : report;
        }

        return {
            ...report,
            _id: report._id ? report._id.toString() : undefined,
            snapshot: report.snapshot
                ? {
                      ...report.snapshot,
                      avatarMediaId: report.snapshot.avatarMediaId
                          ? serializeMedia(report.snapshot.avatarMediaId)
                          : report.snapshot.avatarMediaId,
                  }
                : report.snapshot,
        };
    }

    private serializeAuditLogMetadata(metadata: any) {
        if (
            !metadata ||
            typeof metadata !== 'object' ||
            Array.isArray(metadata)
        ) {
            return metadata;
        }

        return {
            ...metadata,
            oldAvatar: metadata.oldAvatar
                ? serializeMedia(metadata.oldAvatar)
                : metadata.oldAvatar,
            rp_reporterId: metadata.rp_reporterId
                ? typeof metadata.rp_reporterId === 'object' &&
                  '_id' in metadata.rp_reporterId
                    ? serializeUser(metadata.rp_reporterId, false)
                    : metadata.rp_reporterId
                : metadata.rp_reporterId,
            rp_targetUserId: metadata.rp_targetUserId
                ? typeof metadata.rp_targetUserId === 'object' &&
                  '_id' in metadata.rp_targetUserId
                    ? serializeUser(metadata.rp_targetUserId, false)
                    : metadata.rp_targetUserId
                : metadata.rp_targetUserId,
        };
    }

    private serializeTarget(targetType: string, targetId: any) {
        if (!targetId) {
            return targetId;
        }

        if (targetType === 'User') {
            return typeof targetId === 'object' && '_id' in targetId
                ? serializeUser(targetId, false)
                : targetId;
        }

        if (targetType === 'Report') {
            return typeof targetId === 'object' && '_id' in targetId
                ? this.serializeReport(targetId)
                : targetId;
        }

        return targetId;
    }

    private serializeAuditLog(log: any): AuditLogResponse {
        const { actorId, targetId, targetType, metadata, ...rest } = log;

        return {
            ...rest,
            _id: rest._id ? rest._id.toString() : undefined,
            metadata: this.serializeAuditLogMetadata(metadata),
            actor: actorId
                ? typeof actorId === 'object' && '_id' in actorId
                    ? serializeUser(actorId, false)
                    : actorId
                : undefined,
            target: this.serializeTarget(targetType, targetId),
            targetType,
        };
    }

    private sanitizeMetadata(metadata: any) {
        if (
            !metadata ||
            typeof metadata !== 'object' ||
            Array.isArray(metadata)
        ) {
            return {};
        }

        return Object.entries(metadata).reduce<Record<string, any>>(
            (acc, [key, value]) => {
                if (value === undefined || value === null) {
                    return acc;
                }

                if (
                    typeof value === 'string' ||
                    typeof value === 'number' ||
                    typeof value === 'boolean'
                ) {
                    acc[key] = value;
                    return acc;
                }

                if (value instanceof Date) {
                    acc[key] = value.toISOString();
                    return acc;
                }

                if (value instanceof Types.ObjectId) {
                    acc[key] = value.toString();
                    return acc;
                }

                if (typeof value === 'object' && '_id' in value && value._id) {
                    acc[key] = (value._id as Types.ObjectId).toString();
                }

                return acc;
            },
            {},
        );
    }

    async create(auditLog: any) {
        return await this.auditLogModel.create(auditLog);
    }

    @OnEvent('audit.log.create', { async: true })
    async handleAuditLogEvent(payload: AuditLogEvent) {
        try {
            const { req, metadata, ...logData } = payload;

            const ip =
                (req?.headers?.['x-forwarded-for'] as string)
                    ?.split(',')[0]
                    ?.trim() ||
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
                metadata: this.sanitizeMetadata(metadata),
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
            filter.ip = { $regex: new RegExp(escapeRegExp(ip.trim()), 'i') };
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
                populate: [
                    { path: 'avatar', select: '-__v', strictPopulate: false },
                    {
                        path: 'snapshot.avatarMediaId',
                        select: '-__v',
                        strictPopulate: false,
                    },
                ],
            })
            .populate({
                path: 'metadata.rp_reporterId',
                select: '_id name email',
                strictPopulate: false,
            })
            .populate({
                path: 'metadata.rp_targetUserId',
                select: '_id name email',
                strictPopulate: false,
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
