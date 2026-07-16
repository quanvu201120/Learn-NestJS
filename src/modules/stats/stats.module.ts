import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
    SystemDailyStat,
    SystemDailyStatSchema,
} from './schemas/system-daily-stat.schema';
import { StatsService } from './stats.service';
import { StatsController } from './stats.controller';
import { StatsCron } from './cron/stats.cron';
import { MediaModule } from '../media/media.module';
import { StatsWriteService } from './stats-write.service';
import { StatsReadService } from './stats-read.service';
import { StatsHealthService } from './stats-health.service';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: SystemDailyStat.name, schema: SystemDailyStatSchema },
        ]),
        forwardRef(() => MediaModule),
    ],
    controllers: [StatsController],
    providers: [
        StatsService,
        StatsWriteService,
        StatsReadService,
        StatsHealthService,
        StatsCron,
    ],
    exports: [StatsService],
})
export class StatsModule {}
