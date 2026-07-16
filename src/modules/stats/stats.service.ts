import { Injectable } from '@nestjs/common';
import { MessageEnumType } from '../messages/types/message';
import { MediaProviderEnum } from '../media/types/media';
import { STATS_CONSTANTS } from './constants/stats.constant';
import { StatsHealthService } from './stats-health.service';
import { StatsReadService } from './stats-read.service';
import { StatsWriteService } from './stats-write.service';

@Injectable()
export class StatsService {
    constructor(
        private readonly statsWriteService: StatsWriteService,
        private readonly statsReadService: StatsReadService,
        private readonly statsHealthService: StatsHealthService,
    ) {}

    /**
     * Lấy trạng thái sức khoẻ (Ping) của các dịch vụ bên dưới.
     */
    async getSystemHealth() {
        return this.statsHealthService.getSystemHealth();
    }

    /**
     * Cộng 1 vào cột `newUsers` của ngày hôm nay.
     * Được gọi khi một tài khoản mới được tạo thành công.
     */
    async incrementNewUser() {
        return this.statsWriteService.incrementNewUser();
    }

    /**
     * Cộng 1 vào cột `logins` của ngày hôm nay.
     * Được gọi khi một user đăng nhập thành công và nhận được JWT.
     */
    async incrementLogin() {
        return this.statsWriteService.incrementLogin();
    }

    /**
     * Cộng 1 vào cột `newGroups` của ngày hôm nay.
     * Được gọi khi một group chat mới được tạo.
     */
    async incrementNewGroup() {
        return this.statsWriteService.incrementNewGroup();
    }

    /**
     * Cộng 1 vào cột `newDirects` của ngày hôm nay.
     * Được gọi khi một cuộc hội thoại 1-1 mới được tạo lần đầu.
     */
    async incrementNewDirect() {
        return this.statsWriteService.incrementNewDirect();
    }

    /**
     * Cộng 1 vào cột tin nhắn tương ứng (`messagesText`, `messagesImage`, ...) của ngày hôm nay.
     * Loại tin nhắn `SYSTEM` sẽ bị bỏ qua vì không phải do user gửi.
     * @param type - Loại tin nhắn từ enum `MessageEnumType`.
     */
    async incrementMessage(type: MessageEnumType) {
        return this.statsWriteService.incrementMessage(type);
    }

    /**
     * Cộng dồn dung lượng (bytes) vào cột upload tương ứng của ngày hôm nay.
     * @param provider - provider xác định file được upload lên đâu.
     * @param bytes - Kích thước file (bytes) lấy từ `file.size`.
     */
    async incrementUploadBytes(provider: MediaProviderEnum, bytes: number) {
        return this.statsWriteService.incrementUploadBytes(provider, bytes);
    }

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
        return this.statsWriteService.updateCloudUsage(data);
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
        return this.statsWriteService.updateSystemPeaks(
            memoryBytes,
            clients,
            onlineUsers,
        );
    }

    /**
     * Tổng hợp toàn bộ dữ liệu cho trang Overview của Admin Dashboard.
     * Bao gồm:
     * - `daily`: Tổng cộng dồn tất cả các ngày từ bảng `SystemDailyStat`.
     * - `cloud`: Băng thông và dung lượng Cloud của tháng hiện tại từ bảng `MonthlyCloudUsageStat`.
     * - `redis`: Thông số real-time của Redis (memory, clients, uptime).
     */
    async getOverview(startDate?: string, endDate?: string) {
        return this.statsReadService.getOverview(startDate, endDate);
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
        return this.statsReadService.getChartData(
            type,
            limit,
            startDate,
            endDate,
        );
    }
}
