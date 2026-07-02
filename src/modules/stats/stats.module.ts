import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
    SystemDailyStat,
    SystemDailyStatSchema,
} from './schemas/system-daily-stat.schema';
import { StatsService } from './stats.service';
import { StatsController } from './stats.controller';
import { StatsCron } from './cron/stats.cron';
import { MediaModule } from '../media/media.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: SystemDailyStat.name, schema: SystemDailyStatSchema },
        ]),
        MediaModule,
    ],
    controllers: [StatsController],
    providers: [StatsService, StatsCron],
    exports: [StatsService],
})
export class StatsModule {}
