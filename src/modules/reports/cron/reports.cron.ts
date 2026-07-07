/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReportsService } from '../reports.service';

@Injectable()
export class ReportsCron {
    private readonly logger = new Logger(ReportsCron.name);

    constructor(private readonly reportsService: ReportsService) {}

    /**
     * Chạy mỗi ngày lúc nửa đêm để dọn dẹp các báo cáo cũ.
     */
    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async deleteMediasAndReportDismissed() {
        try {
            await this.reportsService.deleteMediasAndReportDismissed();
        } catch (error) {
            this.logger.error(
                'Lỗi khi thực thi cron job deleteMediasAndReportDismissed:',
                error,
            );
        }
    }
}
