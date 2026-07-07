import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StatsService } from '../stats.service';
import { CloudinaryService } from '@/modules/media/providers/cloudinary.service';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@/redis/redis.service';
import { STATS_MESSAGES } from '../constants/stats.constant';

/**
 * Cron Job của Module Stats, dùng để định kỳ đồng bộ dữ liệu với các bên thứ 3.
 */
@Injectable()
export class StatsCron {
    private readonly logger = new Logger(StatsCron.name);

    constructor(
        private readonly statsService: StatsService,
        private readonly cloudinaryService: CloudinaryService,
        private readonly configService: ConfigService,
        private readonly redisService: RedisService,
    ) {}

    /**
     * Chạy mỗi 15 phút.
     * Gọi API của Cloudinary và R2 (qua GraphQL) để lấy thống kê về băng thông
     * và dung lượng lưu trữ, sau đó cập nhật vào bảng `SystemDailyStat`
     * cho ngày hiện tại.
     */
    @Cron('*/15 * * * *')
    async handleCloudUsageTracking() {
        this.logger.log(STATS_MESSAGES.CLOUD_USAGE_SYNC_START);

        let cloudinaryBandwidthBytes = 0;
        let cloudinaryStorageBytes = 0;
        let cloudinaryCreditsUsage = 0;
        let r2BandwidthBytes = 0;
        let r2StorageBytes = 0;

        // 1. Lấy usage từ Cloudinary
        try {
            const usage = (await this.cloudinaryService.getUsage()) as {
                bandwidth?: { usage: number };
                storage?: { usage: number };
                credits?: { usage: number };
            };
            cloudinaryBandwidthBytes = usage.bandwidth?.usage ?? 0;
            cloudinaryStorageBytes = usage.storage?.usage ?? 0;
            cloudinaryCreditsUsage = usage.credits?.usage ?? 0;
        } catch (error) {
            this.logger.error(STATS_MESSAGES.CLOUDINARY_FETCH_FAILED, error);
        }

        // 2. Lấy usage từ R2 qua Cloudflare GraphQL Analytics API
        try {
            const r2Usage = await this.fetchR2Usage();
            r2BandwidthBytes = r2Usage.bandwidthBytes;
            r2StorageBytes = r2Usage.storageBytes;
        } catch (error) {
            this.logger.error(STATS_MESSAGES.R2_FETCH_FAILED, error);
        }

        // 3. Cập nhật vào bảng SystemDailyStat
        try {
            await this.statsService.updateCloudUsage({
                cloudinaryBandwidthBytes,
                cloudinaryStorageBytes,
                cloudinaryCreditsUsage: cloudinaryCreditsUsage || 0,
                r2BandwidthBytes,
                r2StorageBytes,
            });
            this.logger.log(STATS_MESSAGES.CLOUD_USAGE_SYNC_SUCCESS);
        } catch (error) {
            this.logger.error(STATS_MESSAGES.CLOUD_USAGE_SYNC_FAILED, error);
        }
    }

    /**
     * Chạy mỗi 15 phút để lấy RAM, lượng Client hiện tại của Redis, và đếm CCU.
     * Cập nhật vào SystemDailyStat để lấy mức đỉnh (Peak) của hệ thống trong ngày.
     */
    @Cron('*/15 * * * *')
    async handleSystemPeakTracking() {
        try {
            const redisInfo = await this.redisService.getInfo();
            const onlineUsers = await this.redisService.countTotalOnlineUsers();

            if (redisInfo) {
                await this.statsService.updateSystemPeaks(
                    redisInfo.usedMemoryBytes,
                    Number(redisInfo.connectedClients) || 0,
                    onlineUsers,
                );
            }
        } catch (error) {
            this.logger.error('Failed to track system peaks', error);
        }
    }

    /**
     * Helper nội bộ: Gửi truy vấn GraphQL lên Cloudflare Analytics API
     * để lấy tổng băng thông (`r2OperationsAdaptiveGroups`) và
     * dung lượng lưu trữ (`r2StorageAdaptiveGroups`) của tháng hiện tại.
     * Cần cài đặt `CLOUDFLARE_API_TOKEN` và `CLOUDFLARE_ACCOUNT_ID` trong `.env`.
     */
    private async fetchR2Usage(): Promise<{
        bandwidthBytes: number;
        storageBytes: number;
    }> {
        const apiToken = this.configService.get<string>('CLOUDFLARE_API_TOKEN');
        const accountId = this.configService.get<string>('R2_ACCOUNT_ID');
        const bucketName = this.configService.get<string>('R2_BUCKET_NAME');

        if (!apiToken || !accountId) {
            this.logger.warn(STATS_MESSAGES.R2_CONFIG_MISSING);
            return { bandwidthBytes: 0, storageBytes: 0 };
        }

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
            .toISOString()
            .slice(0, 10);
        const today = now.toISOString().slice(0, 10);

        const query = `
            query {
                viewer {
                    accounts(filter: { accountTag: "${accountId}" }) {
                        r2OperationsAdaptiveGroups(
                            filter: {
                                datetime_geq: "${startOfMonth}T00:00:00Z"
                                datetime_leq: "${today}T23:59:59Z"
                                ${bucketName ? `bucketName: "${bucketName}"` : ''}
                            }
                            limit: 1000
                        ) {
                            sum {
                                responseObjectSize
                            }
                        }
                        r2StorageAdaptiveGroups(
                            filter: {
                                datetime_geq: "${today}T00:00:00Z"
                                datetime_leq: "${today}T23:59:59Z"
                                ${bucketName ? `bucketName: "${bucketName}"` : ''}
                            }
                            limit: 1
                        ) {
                            max {
                                payloadSize
                            }
                        }
                    }
                }
            }
        `;

        const response = await fetch(
            'https://api.cloudflare.com/client/v4/graphql',
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query }),
            },
        );

        if (!response.ok) {
            throw new Error(
                `Cloudflare GraphQL API failed with status ${response.status}`,
            );
        }

        const json = (await response.json()) as {
            data?: {
                viewer?: {
                    accounts?: Array<{
                        r2OperationsAdaptiveGroups?: Array<{
                            sum?: { responseObjectSize?: number };
                        }>;
                        r2StorageAdaptiveGroups?: Array<{
                            max?: { payloadSize?: number };
                        }>;
                    }>;
                };
            };
        };

        const account = json.data?.viewer?.accounts?.[0];

        const bandwidthBytes =
            account?.r2OperationsAdaptiveGroups?.reduce(
                (total, group) => total + (group.sum?.responseObjectSize ?? 0),
                0,
            ) ?? 0;

        const storageBytes =
            account?.r2StorageAdaptiveGroups?.[0]?.max?.payloadSize ?? 0;

        return { bandwidthBytes, storageBytes };
    }
}
