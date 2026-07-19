/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import webPush, { PushSubscription as WebPushSubscription } from 'web-push';
import { SessionService } from '../session/session.service';
import { toObjectId } from '@/utils/utils';
import { UpsertPushSubscriptionDto } from './dto/upsert-push-subscription.dto';
import {
    PushSubscription,
    PushSubscriptionDocument,
} from './schemas/push-subscription.schema';
import { UsersService } from '../users/users.service';
import { PUSH_SUBSCRIPTION_CONSTANT } from './constants/push.constant';

type PushPayload = {
    type: string;
    title: string;
    body: string;
    url?: string;
    tag?: string;
    callId?: string;
    conversationId?: string;
};

@Injectable()
export class PushSubscriptionsService {
    private readonly logger = new Logger(PushSubscriptionsService.name);

    constructor(
        @InjectModel(PushSubscription.name)
        private readonly pushSubscriptionModel: Model<PushSubscriptionDocument>,
        private readonly configService: ConfigService,
        private readonly sessionService: SessionService,
        private readonly usersService: UsersService,
    ) {}

    /**
     * Kiểm tra cấu hình VAPID và nạp vào thư viện web-push trước khi gửi.
     */
    private configureWebPush() {
        const subject = this.configService.get<string>('VAPID_SUBJECT');
        const publicKey = this.configService.get<string>('VAPID_PUBLIC_KEY');
        const privateKey = this.configService.get<string>('VAPID_PRIVATE_KEY');

        if (!subject || !publicKey || !privateKey) {
            return false;
        }

        webPush.setVapidDetails(subject, publicKey, privateKey);
        return true;
    }

    /**
     * Kiểm tra dữ liệu tối thiểu trước khi ghi subscription vào database.
     */
    private validateUpsertInput(dto: UpsertPushSubscriptionDto) {
        const deviceId = dto.deviceId?.trim();
        const endpoint = dto.subscription?.endpoint?.trim();
        const p256dh = dto.subscription?.keys?.p256dh?.trim();
        const auth = dto.subscription?.keys?.auth?.trim();

        if (!deviceId || !endpoint || !p256dh || !auth) {
            throw new BadRequestException(
                PUSH_SUBSCRIPTION_CONSTANT.INPUT_INVALID,
            );
        }

        return {
            deviceId,
            endpoint,
            p256dh,
            auth,
        };
    }

    /**
     * Đăng ký hoặc cập nhật push subscription của device hiện tại với owner mới.
     */
    async upsert(userId: string, dto: UpsertPushSubscriptionDto) {
        const objectUserId = toObjectId(userId, 'userId');
        const { deviceId, endpoint, p256dh, auth } =
            this.validateUpsertInput(dto);
        const now = new Date();

        await this.usersService.checkUser(userId);

        await this.pushSubscriptionModel.updateMany(
            {
                deviceId,
                endpoint: { $ne: endpoint },
                isActive: true,
            },
            { $set: { isActive: false } },
        );

        const pushSubscription =
            await this.pushSubscriptionModel.findOneAndUpdate(
                { endpoint },
                {
                    $set: {
                        deviceId,
                        userId: objectUserId,
                        p256dh,
                        auth,
                        isActive: true,
                        lastUsedAt: now,
                    },
                },
                {
                    upsert: true,
                    returnDocument: 'after',
                    setDefaultsOnInsert: true,
                },
            );

        return {
            deviceId: pushSubscription.deviceId,
            isActive: pushSubscription.isActive,
        };
    }

    /**
     * Xóa push subscription của một device nếu user hiện tại đang là owner hợp lệ.
     */
    async removeByDeviceId(
        userId: string,
        deviceId: string,
        session?: ClientSession,
    ) {
        const normalizedDeviceId = deviceId?.trim();
        if (!normalizedDeviceId) {
            throw new BadRequestException(
                PUSH_SUBSCRIPTION_CONSTANT.INPUT_INVALID,
            );
        }

        const result = await this.pushSubscriptionModel
            .deleteMany({
                userId: toObjectId(userId, 'userId'),
                deviceId: normalizedDeviceId,
            })
            .session(session || null);

        return {
            deletedCount: result.deletedCount,
        };
    }

    /**
     * Xóa toàn bộ push subscription của một user khi user đăng xuất khỏi tất cả thiết bị.
     */
    async removeByUserId(userId: string, session?: ClientSession) {
        const result = await this.pushSubscriptionModel
            .deleteMany({
                userId: toObjectId(userId, 'userId'),
            })
            .session(session || null);

        return {
            deletedCount: result.deletedCount,
        };
    }

    /**
     * Gửi push tới toàn bộ subscription active của user.
     * Subscription hỏng sẽ được vô hiệu hóa để lần sau không gửi lại.
     */
    async sendToUser(userId: string, payload: PushPayload) {
        if (!this.configureWebPush()) {
            this.logger.warn('Thiếu cấu hình VAPID');
            return;
        }

        await this.usersService.checkUser(userId);
        const objectUserId = toObjectId(userId, 'userId');

        const subscriptions = await this.pushSubscriptionModel
            .find({
                userId: objectUserId,
                isActive: true,
            })
            .lean();

        await Promise.allSettled(
            subscriptions.map(async (subscription) => {
                const webPushSubscription: WebPushSubscription = {
                    endpoint: subscription.endpoint,
                    keys: {
                        p256dh: subscription.p256dh,
                        auth: subscription.auth,
                    },
                };

                try {
                    await webPush.sendNotification(
                        webPushSubscription,
                        JSON.stringify(payload),
                    );
                    await this.pushSubscriptionModel.updateOne(
                        { _id: subscription._id },
                        { $set: { lastUsedAt: new Date() } },
                    );
                } catch (error) {
                    await this.handleSendError(subscription._id, error);
                }
            }),
        );
    }

    /**
     * Vô hiệu hóa subscription khi push service báo endpoint đã chết hoặc không còn hợp lệ.
     */
    private async handleSendError(subscriptionId: Types.ObjectId, error: any) {
        const statusCode = Number(error?.statusCode || error?.status);

        if (statusCode === 404 || statusCode === 410) {
            await this.pushSubscriptionModel.updateOne(
                { _id: subscriptionId },
                { $set: { isActive: false } },
            );
            return;
        }

        this.logger.warn(
            `Gửi web push thất bại: ${(error as Error)?.message || error}`,
        );
    }

    /**
     * Dọn các subscription đã inactive lâu ngày hoặc không còn session active tương ứng.
     */
    @Cron('0 0 3 * * *')
    async cleanupStaleSubscriptions() {
        await this.pushSubscriptionModel.deleteMany({
            isActive: false,
        });
    }
}
