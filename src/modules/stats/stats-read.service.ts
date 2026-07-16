/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';
import {
    SystemDailyStat,
    SystemDailyStatDocument,
} from './schemas/system-daily-stat.schema';
import { RedisService } from '@/redis/redis.service';
import {
    STATS_CONSTANTS,
    SYSTEM_DAILY_STAT_SUM_FIELDS,
} from './constants/stats.constant';
import { ChartDataResponse } from './types/stats-chart.type';
import { OverviewAggregateResult } from './types/stats-overview.type';

@Injectable()
export class StatsReadService {
    private readonly logger = new Logger('StatsService');

    constructor(
        @InjectModel(SystemDailyStat.name)
        private readonly dailyStatModel: Model<SystemDailyStatDocument>,
        @Inject(forwardRef(() => RedisService))
        private readonly redisService: RedisService,
        private readonly configService: ConfigService,
    ) {}

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

        const monthGroupStage: Record<string, any> = {
            _id: { $substr: ['$date', 0, 7] },
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

        const finalGroupStage: Record<string, any> = {
            _id: null,
            peakOnlineUsers: { $max: '$peakOnlineUsers' },
            redisPeakMemoryBytes: { $max: '$redisPeakMemoryBytes' },
            redisPeakClients: { $max: '$redisPeakClients' },
            cloudinaryStorageBytes: { $max: '$cloudinaryStorageBytes' },
            cloudinaryCreditsUsage: { $sum: '$cloudinaryCreditsUsage' },
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
                  totalMemoryBytes: 1024 * 1024 * 30,
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

        if (type === 'daily') {
            let query = this.dailyStatModel.find(matchStage).sort({ date: -1 });

            if (!hasDateFilter) {
                query = query.limit(limit);
            }

            const stats = await query.lean();
            return stats.reverse();
        }

        const pipeline: PipelineStage[] = [];

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
            const dateLengthMap = { monthly: 7, yearly: 4 };
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

        if (!hasDateFilter) {
            pipeline.push({ $limit: limit });
        }

        const stats = (await this.dailyStatModel.aggregate<ChartDataResponse>(
            pipeline,
        )) as ChartDataResponse[];

        return stats.reverse();
    }
}
