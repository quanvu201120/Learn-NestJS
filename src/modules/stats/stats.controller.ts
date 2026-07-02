import {
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { StatsService } from './stats.service';
import { Roles } from '@/utils/decorator-customize';
import { UserRole } from '@/modules/users/types/user';
import { RolesGuard } from '@/auth/passport/roles.guard';
import { STATS_CONSTANTS } from './constants/stats.constant';

import { StatsCron } from './cron/stats.cron';

/**
 * Controller xử lý các API thống kê dành riêng cho Admin Dashboard.
 * Tất cả các route đều yêu cầu quyền `ADMIN`.
 */
@Controller('stats')
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@UseGuards(RolesGuard)
export class StatsController {
    constructor(
        private readonly statsService: StatsService,
        private readonly statsCron: StatsCron,
    ) {}

    /**
     * API: `GET /stats/overview`
     * Lấy tổng quan toàn bộ hệ thống, bao gồm số liệu cộng dồn từ trước đến nay,
     * số liệu Cloud Usage của tháng hiện tại, và thông số server Redis (real-time).
     */
    @Get('overview')
    async getOverview(
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
    ) {
        return this.statsService.getOverview(startDate, endDate);
    }

    /**
     * API: `GET /stats/health`
     * Kiểm tra trạng thái kết nối tới các dịch vụ (MongoDB, Redis, Cloudinary, R2)
     * và trả về thời gian uptime của server.
     */
    @Get('health')
    async getHealth() {
        return this.statsService.getSystemHealth();
    }

    /**
     * API: `GET /stats/chart`
     * Lấy dữ liệu thống kê để vẽ biểu đồ, cho phép gom nhóm theo ngày, tháng, hoặc năm.
     * @param type - (Optional) 'daily' | 'weekly' | 'monthly' | 'yearly'. Mặc định: 'daily'
     * @param limit - (Optional) Số điểm dữ liệu trên biểu đồ. Mặc định: 30
     */
    @Get('chart')
    async getChartData(
        @Query('type') type?: 'daily' | 'weekly' | 'monthly' | 'yearly',
        @Query('limit') limit?: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
    ) {
        const parsedType =
            type === 'weekly' || type === 'monthly' || type === 'yearly'
                ? type
                : 'daily';

        const parsedLimit = limit
            ? parseInt(limit, 10)
            : STATS_CONSTANTS.DEFAULT_DAILY_LIMIT;

        return this.statsService.getChartData(
            parsedType,
            parsedLimit,
            startDate,
            endDate,
        );
    }

    /**
     * API: `POST /stats/sync`
     * Admin click thủ công để trigger đồng bộ toàn bộ dữ liệu (Cloudinary, R2, Redis) ngay lập tức.
     */
    @HttpCode(HttpStatus.OK)
    @Post('sync')
    async syncAllUsage() {
        await this.statsCron.handleCloudUsageTracking();
        await this.statsCron.handleSystemPeakTracking();
        return true;
    }
}
