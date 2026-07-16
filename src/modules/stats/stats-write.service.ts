/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
    SystemDailyStat,
    SystemDailyStatDocument,
} from './schemas/system-daily-stat.schema';
import { MessageEnumType } from '../messages/types/message';
import { MediaProviderEnum } from '../media/types/media';

@Injectable()
export class StatsWriteService {
    private readonly logger = new Logger('StatsService');

    constructor(
        @InjectModel(SystemDailyStat.name)
        private readonly dailyStatModel: Model<SystemDailyStatDocument>,
    ) {}

    private getToday(): string {
        return new Date().toISOString().slice(0, 10);
    }

    async incrementNewUser() {
        try {
            await this.dailyStatModel.updateOne(
                { date: this.getToday() },
                { $inc: { newUsers: 1 } },
                { upsert: true },
            );
        } catch (error) {
            this.logger.error('Failed to increment newUsers', error);
        }
    }

    async incrementLogin() {
        try {
            await this.dailyStatModel.updateOne(
                { date: this.getToday() },
                { $inc: { logins: 1 } },
                { upsert: true },
            );
        } catch (error) {
            this.logger.error('Failed to increment logins', error);
        }
    }

    async incrementNewGroup() {
        try {
            await this.dailyStatModel.updateOne(
                { date: this.getToday() },
                { $inc: { newGroups: 1 } },
                { upsert: true },
            );
        } catch (error) {
            this.logger.error('Failed to increment newGroups', error);
        }
    }

    async incrementNewDirect() {
        try {
            await this.dailyStatModel.updateOne(
                { date: this.getToday() },
                { $inc: { newDirects: 1 } },
                { upsert: true },
            );
        } catch (error) {
            this.logger.error('Failed to increment newDirects', error);
        }
    }

    async incrementMessage(type: MessageEnumType) {
        const fieldMap: Partial<Record<MessageEnumType, string>> = {
            [MessageEnumType.TEXT]: 'messagesText',
            [MessageEnumType.IMAGE]: 'messagesImage',
            [MessageEnumType.VIDEO]: 'messagesVideo',
            [MessageEnumType.FILE]: 'messagesFile',
            [MessageEnumType.VOICE]: 'messagesVoice',
        };

        const field = fieldMap[type];
        if (!field) return;

        try {
            await this.dailyStatModel.updateOne(
                { date: this.getToday() },
                { $inc: { [field]: 1 } },
                { upsert: true },
            );
        } catch (error) {
            this.logger.error(`Failed to increment ${field}`, error);
        }
    }

    async incrementUploadBytes(provider: MediaProviderEnum, bytes: number) {
        const field =
            provider === MediaProviderEnum.CLOUDINARY
                ? 'uploadBytesCloudinary'
                : 'uploadBytesR2';

        try {
            await this.dailyStatModel.updateOne(
                { date: this.getToday() },
                { $inc: { [field]: bytes } },
                { upsert: true },
            );
        } catch (error) {
            this.logger.error(`Failed to increment ${field}`, error);
        }
    }

    async updateCloudUsage(data: {
        cloudinaryBandwidthBytes: number;
        cloudinaryStorageBytes: number;
        cloudinaryCreditsUsage: number;
        r2BandwidthBytes: number;
        r2StorageBytes: number;
    }) {
        try {
            const todayStr = this.getToday();
            const todayDate = new Date();
            const isFirstDayOfMonth = todayDate.getDate() === 1;

            let cloudinaryDailyBandwidth = data.cloudinaryBandwidthBytes;
            let r2DailyBandwidth = data.r2BandwidthBytes;

            if (!isFirstDayOfMonth) {
                const yesterdayDate = new Date(todayDate);
                yesterdayDate.setDate(yesterdayDate.getDate() - 1);
                const yesterdayStr = yesterdayDate.toISOString().slice(0, 10);

                const yesterdayDoc = await this.dailyStatModel
                    .findOne({ date: yesterdayStr })
                    .lean();

                if (yesterdayDoc) {
                    const yesterdayCloudinaryCumulative =
                        yesterdayDoc.cloudinaryCumulativeMonthlyBandwidthBytes ||
                        0;
                    const yesterdayR2Cumulative =
                        yesterdayDoc.r2CumulativeMonthlyBandwidthBytes || 0;

                    if (
                        data.cloudinaryBandwidthBytes >=
                        yesterdayCloudinaryCumulative
                    ) {
                        cloudinaryDailyBandwidth =
                            data.cloudinaryBandwidthBytes -
                            yesterdayCloudinaryCumulative;
                    }
                    if (data.r2BandwidthBytes >= yesterdayR2Cumulative) {
                        r2DailyBandwidth =
                            data.r2BandwidthBytes - yesterdayR2Cumulative;
                    }
                } else {
                    cloudinaryDailyBandwidth = 0;
                    r2DailyBandwidth = 0;
                }
            }

            await this.dailyStatModel.updateOne(
                { date: todayStr },
                {
                    $set: {
                        cloudinaryBandwidthBytes: cloudinaryDailyBandwidth,
                        r2BandwidthBytes: r2DailyBandwidth,
                        cloudinaryCumulativeMonthlyBandwidthBytes:
                            data.cloudinaryBandwidthBytes,
                        r2CumulativeMonthlyBandwidthBytes:
                            data.r2BandwidthBytes,
                    },
                    $max: {
                        cloudinaryStorageBytes: data.cloudinaryStorageBytes,
                        cloudinaryCreditsUsage: data.cloudinaryCreditsUsage,
                        r2StorageBytes: data.r2StorageBytes,
                    },
                },
                { upsert: true },
            );
        } catch (error) {
            this.logger.error('Failed to update cloud usage', error);
        }
    }

    async updateSystemPeaks(
        memoryBytes: number,
        clients: number,
        onlineUsers: number,
    ) {
        try {
            let mongoStorageBytes = 0;
            const db = this.dailyStatModel.db.db;
            if (db) {
                const dbStats = await db.command({ dbStats: 1 });
                mongoStorageBytes =
                    dbStats.dataSize || dbStats.storageSize || 0;
            }

            await this.dailyStatModel.updateOne(
                { date: this.getToday() },
                {
                    $max: {
                        redisPeakMemoryBytes: memoryBytes,
                        redisPeakClients: clients,
                        peakOnlineUsers: onlineUsers,
                        mongoStorageBytes: mongoStorageBytes,
                    },
                },
                { upsert: true },
            );
        } catch (error) {
            this.logger.error('Failed to update system peaks', error);
        }
    }
}
