import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Report, ReportSchema } from './schemas/report.schema';
import { UsersModule } from '../users/users.module';
import { SessionModule } from '../session/session.module';
import { MediaModule } from '../media/media.module';
import { CleanupJobsModule } from '../cleanup-jobs/cleanup-jobs.module';
import { ReportsCron } from './cron/reports.cron';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportAdminActionService } from './report-admin-action.service';
import { ReportAppealService } from './report-appeal.service';
import { ReportCleanupService } from './report-cleanup.service';
import { ReportMediaService } from './report-media.service';
import { ReportPenaltyService } from './report-penalty.service';
import { ReportQueryService } from './report-query.service';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Report.name, schema: ReportSchema },
        ]),
        forwardRef(() => UsersModule),
        SessionModule,
        forwardRef(() => MediaModule),
        forwardRef(() => CleanupJobsModule),
    ],
    controllers: [ReportsController],
    providers: [
        ReportsService,
        ReportAdminActionService,
        ReportAppealService,
        ReportCleanupService,
        ReportQueryService,
        ReportMediaService,
        ReportPenaltyService,
        ReportsCron,
    ],
    exports: [ReportsService],
})
export class ReportsModule {}
