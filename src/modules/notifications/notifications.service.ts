/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Model, Types } from 'mongoose';
import type {
    CreateNotificationPayload,
    NotificationsPaginationResponse,
    NotificationResponse,
} from './types/notification.type';
import {
    Notification,
    NotificationDocument,
} from './schemas/notification.schema';
import { toObjectId, validateObjectId } from '@/utils/utils';
import { GLOBAL_CONSTANTS } from '@/common/constants/global.constant';
import { serializeMedia } from '../media/utils/media.serializer';

@Injectable()
export class NotificationsService {
    constructor(
        @InjectModel(Notification.name)
        private readonly notificationModel: Model<NotificationDocument>,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    @OnEvent('notification.create')
    async handleCreateNotification(payload: CreateNotificationPayload) {
        const notification = new this.notificationModel({
            userId: new Types.ObjectId(payload.userId),
            type: payload.type,
            title: payload.title,
            refId: payload.refId
                ? new Types.ObjectId(payload.refId)
                : undefined,
            snapshot: payload.snapshot,
            metadata: payload.metadata,
            isRead: false,
        });

        const created = await notification.save();
        this.eventEmitter.emit('notification.created', {
            notificationId: created._id.toString(),
            userId: created.userId.toString(),
        });
        return created;
    }

    private serializeNotification(notification: any): NotificationResponse {
        const { _id, userId, refId, snapshot, ...rest } = notification;
        const metadata = rest.metadata || {};

        const resolvedRef =
            refId && typeof refId === 'object' && '_id' in refId
                ? refId._id?.toString?.() || null
                : refId
                  ? refId.toString()
                  : null;
        const currentReportStatus =
            refId && typeof refId === 'object' && 'status' in refId
                ? refId.status
                : metadata.reportStatus;
        const hasAppealed =
            currentReportStatus === 'resolved'
                ? false
                : [
                        'appeal_pending',
                        'appeal_rejected',
                        'appeal_success',
                    ].includes(currentReportStatus)
                  ? true
                  : undefined;

        return {
            ...rest,
            _id: _id ? _id.toString() : undefined,
            userId: userId ? userId.toString() : undefined,
            refId: resolvedRef,
            metadata,
            hasAppealed,
            snapshot: snapshot
                ? {
                      ...snapshot,
                      avatarMediaId: snapshot.avatarMediaId
                          ? serializeMedia(snapshot.avatarMediaId)
                          : snapshot.avatarMediaId,
                  }
                : snapshot,
        };
    }

    async findAll(
        userId: string,
        cursor?: string,
        limit: number = GLOBAL_CONSTANTS.LIMIT_NOTIFICATIONS_DEFAULT,
    ): Promise<NotificationsPaginationResponse> {
        const objectUserId = toObjectId(userId, 'userId');

        const safeLimit = Math.min(
            Math.max(
                Number(limit) || GLOBAL_CONSTANTS.LIMIT_NOTIFICATIONS_DEFAULT,
                1,
            ),
            50,
        );
        const query: Record<string, any> = { userId: objectUserId };

        if (cursor) {
            validateObjectId(cursor, 'cursor');
            query._id = { $lt: new Types.ObjectId(cursor) };
        }

        const notifications = await this.notificationModel
            .find(query)
            .sort({ createdAt: -1, _id: -1 })
            .limit(safeLimit + 1)
            .populate({
                path: 'refId',
                select: '_id status',
            })
            .populate({
                path: 'snapshot.avatarMediaId',
                select: '-__v',
            })
            .lean();

        const hasNextPage = notifications.length > safeLimit;
        const slicedNotifications = hasNextPage
            ? notifications.slice(0, safeLimit)
            : notifications;
        const serializedNotifications = slicedNotifications.map(
            (notification) => this.serializeNotification(notification),
        );
        const nextCursor =
            serializedNotifications.length > 0 && hasNextPage
                ? serializedNotifications[serializedNotifications.length - 1]
                      ._id
                : null;

        return {
            notifications: serializedNotifications,
            nextCursor,
        };
    }

    async unreadCount(userId: string) {
        const objectUserId = toObjectId(userId, 'userId');
        const unreadCount = await this.notificationModel.countDocuments({
            userId: objectUserId,
            isRead: false,
        });

        return { unreadCount };
    }

    async markRead(userId: string, id: string) {
        const objectUserId = toObjectId(userId, 'userId');
        const objectId = toObjectId(id, 'notificationId');

        const notification = await this.notificationModel.findOneAndUpdate(
            {
                _id: objectId,
                userId: objectUserId,
                isRead: false,
            },
            {
                $set: {
                    isRead: true,
                    readAt: new Date(),
                },
            },
            { returnDocument: 'after' },
        );

        if (!notification) {
            return { success: false };
        }

        return { success: true };
    }

    async markAllRead(userId: string) {
        const objectUserId = toObjectId(userId, 'userId');

        const result = await this.notificationModel.updateMany(
            { userId: objectUserId, isRead: false },
            {
                $set: {
                    isRead: true,
                    readAt: new Date(),
                },
            },
        );

        return {
            modifiedCount: result.modifiedCount,
        };
    }
}
