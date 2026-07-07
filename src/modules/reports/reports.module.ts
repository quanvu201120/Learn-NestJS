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
    providers: [ReportsService, ReportsCron],
    exports: [ReportsService],
})
export class ReportsModule {}
