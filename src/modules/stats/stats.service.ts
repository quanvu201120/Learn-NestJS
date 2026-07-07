/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable prefer-const */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';
import {
    SystemDailyStat,
    SystemDailyStatDocument,
} from './schemas/system-daily-stat.schema';
import { MessageEnumType } from '../messages/types/message';
import { MediaProviderEnum } from '../media/types/media';
import { RedisService } from '@/redis/redis.service';
import { CloudinaryService } from '@/modules/media/providers/cloudinary.service';
import { R2Service } from '@/modules/media/providers/r2.service';
import {
    STATS_CONSTANTS,
    SYSTEM_DAILY_STAT_SUM_FIELDS,
} from './constants/stats.constant';
import { ChartDataResponse } from './types/stats-chart.type';
import { OverviewAggregateResult } from './types/stats-overview.type';

@Injectable()
export class StatsService {
    private readonly logger = new Logger(StatsService.name);

    constructor(
        @InjectModel(SystemDailyStat.name)
        private readonly dailyStatModel: Model<SystemDailyStatDocument>,
        private readonly redisService: RedisService,
        private readonly cloudinaryService: CloudinaryService,
        private readonly r2Service: R2Service,
        private readonly configService: ConfigService,
    ) {}

    // ─── Health Check ───

    /**
     * Lấy trạng thái sức khoẻ (Ping) của các dịch vụ bên dưới.
     */
    async getSystemHealth() {
        const measure = async (promise: Promise<any>) => {
            const start = Date.now();
            try {
                const res = await promise;
                if (res === false) return { status: false, ping: 0 };
                return { status: true, ping: Date.now() - start };
            } catch (error) {
                return { status: false, ping: 0 };
            }
        };

        const [mongoHealth, redisHealth, cloudinaryHealth, r2Health] =
            await Promise.all([
                measure(
                    this.dailyStatModel.db.db
                        ? this.dailyStatModel.db.db.command({ ping: 1 })
                        : Promise.resolve(false),
                ),
                measure(this.redisService.ping()),
                measure(this.cloudinaryService.ping()),
                measure(this.r2Service.ping()),
            ]);

        return {
            uptimeSeconds: process.uptime(),
            services: {
                mongodb: mongoHealth,
                redis: redisHealth,
                cloudinary: cloudinaryHealth,
                r2: r2Health,
            },
        };
    }

    // ─── Helpers ───

    /**
     * Trả về ngày hiện tại dưới dạng chuỗi `YYYY-MM-DD` để làm khóa chính cho bảng `SystemDailyStat`.
     */
    private getToday(): string {
        return new Date().toISOString().slice(0, 10);
    }

    /**
     * Trả về tháng hiện tại dưới dạng chuỗi `YYYY-MM` để làm khóa chính cho bảng `MonthlyCloudUsageStat`.
     */
    private getCurrentMonth(): string {
        return new Date().toISOString().slice(0, 7);
    }

    // ─── Increment Methods (fire-and-forget, lỗi chỉ log không throw) ───

    /**
     * Cộng 1 vào cột `newUsers` của ngày hôm nay.
     * Được gọi khi một tài khoản mới được tạo thành công.
     */
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

    /**
     * Cộng 1 vào cột `logins` của ngày hôm nay.
     * Được gọi khi một user đăng nhập thành công và nhận được JWT.
     */
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

    /**
     * Cộng 1 vào cột `newGroups` của ngày hôm nay.
     * Được gọi khi một group chat mới được tạo.
     */
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

    /**
     * Cộng 1 vào cột `newDirects` của ngày hôm nay.
     * Được gọi khi một cuộc hội thoại 1-1 mới được tạo lần đầu.
     */
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

    /**
     * Cộng 1 vào cột tin nhắn tương ứng (`messagesText`, `messagesImage`, ...) của ngày hôm nay.
     * Loại tin nhắn `SYSTEM` sẽ bị bỏ qua vì không phải do user gửi.
     * @param type - Loại tin nhắn từ enum `MessageEnumType`.
     */
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

    /**
     * Cộng dồn dung lượng (bytes) vào cột upload tương ứng của ngày hôm nay.
     * @param provider - provider xác định file được upload lên đâu.
     * @param bytes - Kích thước file (bytes) lấy từ `file.size`.
     */
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

    // ─── Cron: Lưu Cloud Usage theo tháng ───

    /**
     * Cập nhật số liệu Cloud Usage (băng thông, lưu trữ) theo từng ngày.
     */
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

            // Nếu không phải ngày đầu tháng, lấy số liệu cộng dồn của ngày hôm qua để trừ ra
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

                    // Nếu API trả về nhỏ hơn hôm qua => có thể có reset chu kỳ billing, lấy luôn số API
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
                    // Nếu ngày hôm qua chưa có dữ liệu (ứng dụng mới chạy), user yêu cầu set ngày đầu bằng 0
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

    /**
     * Cập nhật "Đỉnh" (Peak) của hệ thống trong ngày.
     * Dùng toán tử `$max` để đảm bảo chỉ lưu lại con số lớn nhất từng ghi nhận được.
     */
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

    // ─── Read: API cho Dashboard ───

    /**
     * Tổng hợp toàn bộ dữ liệu cho trang Overview của Admin Dashboard.
     * Bao gồm:
     * - `daily`: Tổng cộng dồn tất cả các ngày từ bảng `SystemDailyStat`.
     * - `cloud`: Băng thông và dung lượng Cloud của tháng hiện tại từ bảng `MonthlyCloudUsageStat`.
     * - `redis`: Thông số real-time của Redis (memory, clients, uptime).
     */
    async getOverview(startDate?: string, endDate?: string) {
        const pipeline: PipelineStage[] = [];

        const matchStage: any = {};
        if (startDate || endDate) {
            const dateQuery: { $gte?: string; $lte?: string } = {};
            if (startDate) dateQuery.$gte = startDate;
            if (endDate) dateQuery.$lte = endDate;
            matchStage.date = dateQuery;
            pipeline.push({ $match: matchStage });
        }

        // --- STAGE 1: Group by Month to get Monthly Peaks ---
        const monthGroupStage: Record<string, any> = {
            _id: { $substr: ['$date', 0, 7] }, // Group by YYYY-MM
            peakOnlineUsers: { $max: '$peakOnlineUsers' },
            redisPeakMemoryBytes: { $max: '$redisPeakMemoryBytes' },
            redisPeakClients: { $max: '$redisPeakClients' },
            cloudinaryStorageBytes: { $max: '$cloudinaryStorageBytes' },
            cloudinaryCreditsUsage: { $max: '$cloudinaryCreditsUsage' },
            r2StorageBytes: { $max: '$r2StorageBytes' },
            mongoStorageBytes: { $max: '$mongoStorageBytes' },
            cloudinaryBandwidthBytes: { $sum: '$cloudinaryBandwidthBytes' },
            r2BandwidthBytes: { $sum: '$r2BandwidthBytes' },
        };

        SYSTEM_DAILY_STAT_SUM_FIELDS.forEach((field) => {
            monthGroupStage[field] = { $sum: `$${field}` };
        });

        pipeline.push({ $group: monthGroupStage });

        // --- STAGE 2: Aggregate across all matched months ---
        const finalGroupStage: Record<string, any> = {
            _id: null,
            peakOnlineUsers: { $max: '$peakOnlineUsers' },
            redisPeakMemoryBytes: { $max: '$redisPeakMemoryBytes' },
            redisPeakClients: { $max: '$redisPeakClients' },
            cloudinaryStorageBytes: { $max: '$cloudinaryStorageBytes' },
            cloudinaryCreditsUsage: { $sum: '$cloudinaryCreditsUsage' }, // Sum of monthly peaks!
            r2StorageBytes: { $max: '$r2StorageBytes' },
            mongoStorageBytes: { $max: '$mongoStorageBytes' },
            cloudinaryBandwidthBytes: { $sum: '$cloudinaryBandwidthBytes' },
            r2BandwidthBytes: { $sum: '$r2BandwidthBytes' },
        };

        SYSTEM_DAILY_STAT_SUM_FIELDS.forEach((field) => {
            const capitalizedField =
                field.charAt(0).toUpperCase() + field.slice(1);
            finalGroupStage[`total${capitalizedField}`] = { $sum: `$${field}` };
        });

        pipeline.push({ $group: finalGroupStage });

        const aggregationResult =
            await this.dailyStatModel.aggregate<OverviewAggregateResult>(
                pipeline,
            );

        const totals = aggregationResult[0] || {};

        let latestDailyStatInPeriod: SystemDailyStat | null = null;
        latestDailyStatInPeriod = await this.dailyStatModel
            .findOne(matchStage)
            .sort({ date: -1 })
            .lean();

        const hasDateFilter = !!(startDate || endDate);

        const cloudUsage = hasDateFilter
            ? {
                  cloudinaryBandwidthBytes:
                      latestDailyStatInPeriod?.cloudinaryCumulativeMonthlyBandwidthBytes ||
                      0,
                  cloudinaryStorageBytes: totals.cloudinaryStorageBytes || 0,
                  cloudinaryCreditsUsage:
                      latestDailyStatInPeriod?.cloudinaryCreditsUsage || 0,
                  r2BandwidthBytes:
                      latestDailyStatInPeriod?.r2CumulativeMonthlyBandwidthBytes ||
                      0,
                  r2StorageBytes: totals.r2StorageBytes || 0,
                  currentCloudinaryStorageBytes:
                      latestDailyStatInPeriod?.cloudinaryStorageBytes || 0,
                  currentR2StorageBytes:
                      latestDailyStatInPeriod?.r2StorageBytes || 0,
              }
            : {
                  cloudinaryBandwidthBytes:
                      totals.cloudinaryBandwidthBytes || 0,
                  cloudinaryStorageBytes: totals.cloudinaryStorageBytes || 0,
                  cloudinaryCreditsUsage: totals.cloudinaryCreditsUsage || 0,
                  r2BandwidthBytes: totals.r2BandwidthBytes || 0,
                  r2StorageBytes: totals.r2StorageBytes || 0,
                  currentCloudinaryStorageBytes:
                      latestDailyStatInPeriod?.cloudinaryStorageBytes || 0,
                  currentR2StorageBytes:
                      latestDailyStatInPeriod?.r2StorageBytes || 0,
              };

        const redisInfo = hasDateFilter
            ? {
                  usedMemoryBytes: totals.redisPeakMemoryBytes || 0,
                  connectedClients: totals.redisPeakClients || 0,
                  totalMemoryBytes: 1024 * 1024 * 30, // Mock 30MB total for historical
                  uptimeInSeconds: 0,
              }
            : await this.redisService.getInfo();

        let mongoStorageBytes = 0;
        if (hasDateFilter) {
            mongoStorageBytes = totals.mongoStorageBytes || 0;
        } else {
            try {
                const db = this.dailyStatModel.db.db;
                if (db) {
                    const dbStats = await db.command({ dbStats: 1 });
                    mongoStorageBytes =
                        dbStats.dataSize || dbStats.storageSize || 0;
                }
            } catch (error) {
                this.logger.warn('Failed to get mongo stats: ' + error.message);
            }
        }

        return {
            totals: totals || {},
            current: {
                cloud: cloudUsage,
                redis: redisInfo,
                mongoStorageBytes,
            },
            systemLimits: {
                cloudinaryBandwidthBytes:
                    Number(
                        this.configService.get<number>(
                            'CLOUDINARY_BANDWIDTH_LIMIT_GB',
                        ),
                    ) *
                    1024 *
                    1024 *
                    1024,
                cloudinaryStorageBytes:
                    Number(
                        this.configService.get<number>(
                            'CLOUDINARY_STORAGE_LIMIT_GB',
                        ),
                    ) *
                    1024 *
                    1024 *
                    1024,
                r2StorageBytes:
                    Number(
                        this.configService.get<number>('R2_STORAGE_LIMIT_GB'),
                    ) *
                    1024 *
                    1024 *
                    1024,
                database: Number(
                    this.configService.get<number>('MONGO_MAX_STORAGE_MB'),
                ),
            },
        };
    }

    /**
     * Lấy dữ liệu thống kê để vẽ biểu đồ, cho phép gom nhóm theo ngày, tháng, hoặc năm.
     * @param type - 'daily' | 'monthly' | 'yearly'
     * @param limit - Số lượng điểm dữ liệu trên biểu đồ (mặc định: 30)
     */
    async getChartData(
        type: 'daily' | 'weekly' | 'monthly' | 'yearly' = 'daily',
        limit: number = STATS_CONSTANTS.DEFAULT_DAILY_LIMIT,
        startDate?: string,
        endDate?: string,
    ) {
        const dateQuery: { $gte?: string; $lte?: string } = {};
        if (startDate) dateQuery.$gte = startDate;
        if (endDate) dateQuery.$lte = endDate;

        const matchStage = startDate || endDate ? { date: dateQuery } : {};

        const hasDateFilter = !!(startDate || endDate);

        // Nếu lấy theo ngày, query trực tiếp bảng SystemDailyStat
        if (type === 'daily') {
            let query = this.dailyStatModel.find(matchStage).sort({ date: -1 });

            // Nếu người dùng lọc ngày thì không giới hạn số lượng limit nữa để trả về trọn vẹn khoảng thời gian
            if (!hasDateFilter) {
                query = query.limit(limit);
            }

            const stats = await query.lean();
            return stats.reverse();
        }

        // Nếu lấy theo tháng/năm/tuần, dùng aggregate
        let pipeline: PipelineStage[] = [];

        // Lọc ngày trước khi gom nhóm
        if (hasDateFilter) {
            pipeline.push({ $match: matchStage });
        }

        if (type === 'weekly') {
            pipeline.push({
                $group: {
                    _id: {
                        year: { $isoWeekYear: '$date' },
                        week: { $isoWeek: '$date' },
                    },
                    redisPeakMemoryBytes: { $max: '$redisPeakMemoryBytes' },
                    redisPeakClients: { $max: '$redisPeakClients' },
                    redisAvgMemoryBytes: { $avg: '$redisPeakMemoryBytes' },
                    redisAvgClients: { $avg: '$redisPeakClients' },
                    peakOnlineUsers: { $max: '$peakOnlineUsers' },
                    avgOnlineUsers: { $avg: '$peakOnlineUsers' },
                    cloudinaryStorageBytes: { $max: '$cloudinaryStorageBytes' },
                    r2StorageBytes: { $max: '$r2StorageBytes' },
                    mongoStorageBytes: { $max: '$mongoStorageBytes' },
                    date: { $first: '$date' },
                    newUsers: { $sum: '$newUsers' },
                    logins: { $sum: '$logins' },
                    newGroups: { $sum: '$newGroups' },
                    newDirects: { $sum: '$newDirects' },
                    messagesText: { $sum: '$messagesText' },
                    messagesImage: { $sum: '$messagesImage' },
                    messagesVideo: { $sum: '$messagesVideo' },
                    messagesFile: { $sum: '$messagesFile' },
                    messagesVoice: { $sum: '$messagesVoice' },
                    uploadBytesCloudinary: { $sum: '$uploadBytesCloudinary' },
                    uploadBytesR2: { $sum: '$uploadBytesR2' },
                },
            });

            pipeline.push({ $sort: { '_id.year': -1, '_id.week': -1 } });

            pipeline.push({
                $addFields: {
                    date: {
                        $concat: [
                            { $toString: '$_id.year' },
                            '-W',
                            {
                                $cond: {
                                    if: { $lt: ['$_id.week', 10] },
                                    then: {
                                        $concat: [
                                            '0',
                                            { $toString: '$_id.week' },
                                        ],
                                    },
                                    else: { $toString: '$_id.week' },
                                },
                            },
                        ],
                    },
                },
            });
        } else {
            const dateLengthMap = { monthly: 7, yearly: 4 }; // 'YYYY-MM' = 7 ký tự, 'YYYY' = 4 ký tự
            const substrLength = dateLengthMap[type as 'monthly' | 'yearly'];

            const groupStage: Record<string, any> = {
                _id: { $substr: ['$date', 0, substrLength] },
                date: { $first: { $substr: ['$date', 0, substrLength] } },
                redisPeakMemoryBytes: { $max: '$redisPeakMemoryBytes' },
                redisPeakClients: { $max: '$redisPeakClients' },
                redisAvgMemoryBytes: { $avg: '$redisPeakMemoryBytes' },
                redisAvgClients: { $avg: '$redisPeakClients' },
                peakOnlineUsers: { $max: '$peakOnlineUsers' },
                avgOnlineUsers: { $avg: '$peakOnlineUsers' },
                cloudinaryStorageBytes: { $max: '$cloudinaryStorageBytes' },
                r2StorageBytes: { $max: '$r2StorageBytes' },
                mongoStorageBytes: { $max: '$mongoStorageBytes' },
            };

            SYSTEM_DAILY_STAT_SUM_FIELDS.forEach((field) => {
                groupStage[field] = { $sum: `$${field}` };
            });

            pipeline.push({ $group: groupStage });
            pipeline.push({ $sort: { _id: -1 } });
        }

        // Tương tự, bỏ qua limit nếu đã chọn ngày
        if (!hasDateFilter) {
            pipeline.push({ $limit: limit });
        }

        const stats = (await this.dailyStatModel.aggregate<ChartDataResponse>(
            pipeline,
        )) as ChartDataResponse[];

        return stats.reverse();
    }
}
